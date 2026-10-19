#include <pandoeditor/commands.h>
#include <pandoeditor/project.h>
#include "documentstate.h"
#include <set>

namespace pandoeditor {
PrepareResult CommandProcessor::prepareBatch(const ProjectSnapshot& original,std::size_t count,
                                            const CommandBatchBuilder& build,const std::string& operation) {
    PrepareResult result;
    if(operation!="document.batch"&&!isWebGeometryBatchCommand(operation)) {
        result.error=CommandError::InvalidCommand;result.detail="unknown batch operation";return result;
    }
    if(!count){result.status=CommandStatus::NoOp;return result;}
    if(!build){result.error=CommandError::InvalidArguments;result.detail="batch builder required";return result;}
    auto current=original;std::set<ObjectRef> targets;bool checkpoint=false,boundaryLabels=false,territorialState=false,clearsSelection=false;
    for(std::size_t index=0;index<count;++index) {
        const auto request=build(current,index);
        auto prepared=prepareRequest(current,request,{},operation=="document.batch"?std::string{}:operation);
        if(!prepared.ok())return prepared;
        targets.insert(request.targets.begin(),request.targets.end());
        if(!prepared.preview)continue;
        territorialState=territorialState||advancesWebStateRevision(request);
        const auto& change=*prepared.preview->change_;
        clearsSelection=clearsSelection||change.clearsSelection();
        checkpoint=checkpoint||change.historyCheckpoint_;
        const auto* mutation=std::get_if<ApplyTerritorialMutation>(&request.args.action);
        boundaryLabels=boundaryLabels||(mutation&&mutation->plan.kind==TerritorialMutationKind::ReconcileSharedBoundary
            &&std::holds_alternative<SharedBoundaryIntent>(mutation->plan.intent));
        // Intermediate candidates never become Project state or history entries.
        // Retain only the original and latest immutable state, not a batch ledger.
        current=ProjectSnapshot{change.after_,original.instanceId(),original.revision(),original.timelineMonth(),original.timelineEditsEnabled()};
    }
    if(!checkpoint&&semanticallyEqual(original.document(),current.document())) {
        result.status=CommandStatus::NoOp;return result;
    }
    std::shared_ptr<const detail::DocumentState> finalState=current.state_;
    if(operation!="document.batch")try {finalState=std::make_shared<const detail::DocumentState>(current.document());}
        catch(const std::invalid_argument& error){result.error=CommandError::ValidationFailed;result.detail=error.what();return result;}
    CommandRequest request{operation,original.instanceId(),original.document().documentId,
        original.revision(),{targets.begin(),targets.end()},{}};
    auto change=std::unique_ptr<ChangeSet>(new ChangeSet(original.state_,std::move(finalState),std::move(request)));
    change->impact_=calculateChangeImpact(change->before(),change->after(),change->request_.targets,original.timelineMonth());
    change->historyCheckpoint_=checkpoint;change->batchBoundaryLabelSettings_=boundaryLabels;change->batchWebStateRevision_=territorialState||isWebGeometryBatchCommand(operation);
    change->batchClearsSelection_=clearsSelection;
    result.preview=CommandPreview(std::move(change));result.status=CommandStatus::Prepared;return result;
}
}
