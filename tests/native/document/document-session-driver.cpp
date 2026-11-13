// P5-7: a JSON-lines adapter to the real native DocumentSession.
// This test utility owns no temporal, geometry, history or rollback algorithm.
// stdin: {"op":"method","args":{...}}, one request per line.
// stdout: {"ok":true,"result":...} or {"ok":false,"error":{...}}.
#include <pandoeditor/document-session.h>
#include <pandoeditor/webterritorialcommands.h>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <memory>
#include <string>

using namespace pandoeditor;
using V = codecjson::Value;

namespace {
const projectcodec::PlatformPorts ports{
    [](const std::string&) {}, true, codecjson::ParsedTextPolicy::PreserveUtf16};

[[noreturn]] void invalid(const std::string& detail) {
    throw TimelineError("PROBE_INPUT", detail);
}
const V& field(const V& value, const char* key) {
    if (value.kind != V::Object) invalid("An argument object is required.");
    const auto found = value.object.find(key);
    if (found == value.object.end()) invalid(std::string("Missing argument: ") + key);
    return found->second;
}
const V& optionalField(const V& value, const char* key) {
    static const V null;
    if (value.kind != V::Object) return null;
    const auto found = value.object.find(key);
    return found == value.object.end() ? null : found->second;
}
std::string string(const V& value) {
    if (value.kind != V::String) invalid("A string argument is required.");
    return value.string;
}
std::string string(const V& value, const char* key) { return string(field(value, key)); }
std::string optionalString(const V& value, const char* key, const std::string& fallback = {}) {
    const auto& item = optionalField(value, key);
    return item.kind == V::Null ? fallback : string(item);
}
std::uint64_t integer(const V& value, std::uint64_t maximum = 9007199254740991ull) {
    if (value.kind != V::Number) invalid("An integer argument is required.");
    const auto number = codecjson::finiteNumber(value);
    if (std::floor(number) != number || number < 0 || number > static_cast<double>(maximum))
        invalid("An integer argument is outside its supported range.");
    return static_cast<std::uint64_t>(number);
}
std::uint32_t handle(const V& args, const char* key) {
    return static_cast<std::uint32_t>(integer(field(args, key), 4294967295ull));
}
V number(std::uint64_t value) { return V::num(static_cast<double>(value)); }
V optional(const std::optional<std::string>& value) { return value ? V::str(*value) : V{}; }
V objectRef(const ObjectRef& ref) {
    auto value = V::obj();
    value.object["domain"] = V::str(ref.domain);
    value.object["id"] = V::str(ref.id);
    return value;
}
V geometryRef(const GeometryRef& ref) {
    auto value = V::obj();
    value.object["id"] = V::str(ref.id);
    value.object["version"] = number(ref.version);
    return value;
}
V world(const ResolvedWorld& input) {
    auto value = V::obj(), entities = V::arr();
    value.object["month"] = V::str(input.month);
    for (const auto& row : input.entities) {
        auto entity = V::obj(), ancestors = V::arr(), properties = V::obj();
        entity.object["objectRef"] = objectRef(row.objectRef);
        entity.object["geometryRef"] = geometryRef(row.geometryRef);
        entity.object["rendering"] = codecjson::parse(row.rendering);
        entity.object["parentId"] = V::str(row.parentId);
        entity.object["coverageMode"] = V::str(row.coverageMode);
        entity.object["rootId"] = V::str(row.rootId);
        entity.object["validFrom"] = optional(row.validity.from);
        entity.object["validTo"] = optional(row.validity.to);
        for (const auto& id : row.ancestors) ancestors.array.push_back(V::str(id));
        for (const auto& [name, json] : row.properties) properties.object[name] = codecjson::parse(json);
        entity.object["ancestors"] = std::move(ancestors);
        entity.object["properties"] = std::move(properties);
        entities.array.push_back(std::move(entity));
    }
    value.object["entities"] = std::move(entities);
    return value;
}
V state(const DocumentSessionState& input) {
    auto value = V::obj(), dirtyIds = V::arr();
    value.object["epoch"] = number(input.epoch);
    value.object["stateRevision"] = number(input.stateRevision);
    value.object["revision"] = number(input.revision);
    value.object["checkpoint"] = number(input.checkpoint);
    value.object["undoCommandId"] = V::str(input.undoCommandId);
    value.object["redoCommandId"] = V::str(input.redoCommandId);
    value.object["dirty"] = V::boolean(input.dirty);
    value.object["canUndo"] = V::boolean(input.canUndo);
    value.object["canRedo"] = V::boolean(input.canRedo);
    value.object["timelineCursor"] = V::str(input.timelineCursor);
    value.object["presentationRevision"] = number(input.presentationRevision);
    value.object["presentationCheckpoint"] = number(input.presentationCheckpoint);
    value.object["documentDirty"] = V::boolean(input.documentDirty);
    value.object["presentationDirty"] = V::boolean(input.presentationDirty);
    value.object["timelineEditsEnabled"] = V::boolean(input.timelineEditsEnabled);
    value.object["storageBaselineId"] = number(input.storageBaselineId);
    for (const auto& id : input.dirtyTerritorialIds) dirtyIds.array.push_back(V::str(id));
    value.object["dirtyTerritorialIds"] = std::move(dirtyIds);
    return value;
}
V selectionRef(const SelectionRef& ref) {
    auto value = V::obj();
    value.object["domain"] = V::str(ref.domain);
    value.object["type"] = V::str(ref.type);
    value.object["id"] = V::str(ref.id);
    return value;
}
SelectionRef readSelectionRef(const V& value) {
    if (value.kind == V::Null) return {};
    return {string(value, "domain"), string(value, "type"), string(value, "id")};
}
V selection(const SelectionState& input) {
    auto value = V::obj(), items = V::arr();
    value.object["selectionRevision"] = number(input.revision());
    value.object["hoverRevision"] = number(input.hoverRevision());
    for (const auto& ref : input.items()) items.array.push_back(selectionRef(ref));
    value.object["items"] = std::move(items);
    value.object["primary"] = input.primary() ? selectionRef(*input.primary()) : V{};
    value.object["hover"] = input.hover() ? selectionRef(*input.hover()) : V{};
    return value;
}
V coordinate(Point point) {
    auto value = V::arr();
    value.array = {V::num(point.x), V::num(point.y)};
    return value;
}
Point readPoint(const V& value) {
    if (value.kind != V::Array || value.array.size() != 2) invalid("A coordinate pair is required.");
    return {codecjson::finiteNumber(value.array[0]), codecjson::finiteNumber(value.array[1])};
}
V draft(const DocumentSession& session) {
    const auto& input = session.draft();
    auto value = V::obj(), coordinates = V::arr(), target = V{};
    for (const auto point : input.coordinates()) coordinates.array.push_back(coordinate(point));
    value.object["active"] = V::boolean(session.draftActive());
    value.object["shape"] = V::str(input.geometry().type == "Polygon" ? "polygon" : "line");
    value.object["coords"] = std::move(coordinates);
    value.object["selectedVertexIndex"] = input.selectedVertexIndex() < 0 ? V{} : V::num(input.selectedVertexIndex());
    value.object["inputPhase"] = V::str(input.inputPhase());
    value.object["insertMode"] = V::boolean(input.vertexInsertMode());
    if (input.insertTarget()) {
        target = V::obj();
        target.object["segmentIndex"] = V::num(input.insertTarget()->segmentIndex);
        target.object["coordinate"] = coordinate(input.insertTarget()->coordinate);
    }
    value.object["insertTarget"] = std::move(target);
    value.object["dragging"] = V::boolean(input.dragging());
    value.object["historyCount"] = number(input.historyCount());
    value.object["futureCount"] = number(input.futureCount());
    value.object["revision"] = number(input.revision());
    return value;
}
V outcome(const DocumentSessionOutcome& input, const DocumentSession& session) {
    auto value = V::obj();
    value.object["ok"] = V::boolean(input.result.ok());
    value.object["changed"] = V::boolean(input.result.changed() || input.candidateId != 0);
    value.object["candidateId"] = number(input.candidateId);
    value.object["state"] = state(session.projectState());
    value.object["selection"] = selection(session.selection());
    const char* status = input.result.status == CommandStatus::Prepared ? "prepared"
        : input.result.status == CommandStatus::Applied ? "applied"
        : input.result.status == CommandStatus::NoOp ? "noop" : "rejected";
    value.object["status"] = V::str(status);
    auto error = V{};
    if (!input.result.ok()) {
        error = V::obj();
        error.object["code"] = V::str(input.domainErrorCode.empty()
            ? std::string(commandErrorCode(input.result.error)) : input.domainErrorCode);
        error.object["message"] = V::str(input.result.detail);
    }
    value.object["error"] = std::move(error);
    if (!input.delta.empty()) value.object["delta"] = codecjson::parse(input.delta);
    return value;
}
projectcodec::WebStorageAssetSource source(const V& input) {
    projectcodec::WebStorageAssetSource value;
    if (string(input, "kind") != "stored-asset") invalid("A stored-asset source is required.");
    const auto& bytes = field(input, "sourceBytes");
    if (bytes.kind != V::Array) invalid("sourceBytes must be a numeric byte array.");
    value.sourceBytes.reserve(bytes.array.size());
    for (const auto& item : bytes.array) value.sourceBytes.push_back(static_cast<std::uint8_t>(integer(item, 255)));
    value.encoding = string(input, "encoding");
    value.baseDataset = string(input, "baseDataset");
    value.sourceMonth = string(input, "sourceMonth");
    value.fingerprint = string(input, "fingerprint");
    value.compressedBytes = integer(field(input, "compressedBytes"));
    value.decodedBytes = integer(field(input, "decodedBytes"));
    return value;
}
V applySelection(DocumentSession& session, const V& args) {
    session.requireEpoch(handle(args, "expectedEpoch"));
    auto& current = session.selection();
    const auto action = string(args, "action"), scope = optionalString(args, "scope");
    const auto& input = optionalField(args, "ref");
    const auto ref = readSelectionRef(input);
    bool countNoOp = true;
    if (action == "replace" || action == "toggle") {
        if (session.selectionRefExists(ref)) {
            if (action == "replace") current.replace(ref, scope);
            else current.toggle(ref, scope);
        }
    } else if (action == "clear") current.clear();
    else if (action == "resetProject") current.resetProject();
    else if (action == "setHover") {
        if (input.kind == V::Null || session.selectionRefExists(ref))
            countNoOp = current.setHover(input.kind == V::Null ? std::nullopt : std::optional<SelectionRef>{ref},
                optionalString(args, "source"), optionalString(args, "expectedKey"));
    } else invalid("Unsupported probe selection action: " + action);
    auto value = V::obj();
    value.object["selection"] = selection(current);
    value.object["countNoOp"] = V::boolean(countNoOp);
    return value;
}
V applyDraft(DocumentSession& session, const V& args) {
    session.requireEpoch(handle(args, "expectedEpoch"));
    const auto& revision = optionalField(args, "expectedDraftRevision");
    if (revision.kind != V::Null) session.requireDraftRevision(integer(revision));
    const auto action = string(args, "action");
    bool result = false;
    if (action == "start") {
        const auto& input = field(args, "coords");
        if (input.kind != V::Array) invalid("Draft coordinates must be an array.");
        Ring coordinates;
        for (const auto& point : input.array) coordinates.push_back(readPoint(point));
        result = session.startDraft(string(args, "shape"), coordinates, optionalString(args, "inputPhase", "draw"));
    } else if (action == "clear" || action == "stop") {
        session.clearDraft(action == "stop");
        result = true;
    } else if (session.draftActive()) {
        if (action == "append") result = session.draft().append(readPoint(field(args, "coordinate")));
        else if (action == "undo") result = session.draft().undo();
        else if (action == "redo") result = session.draft().redo();
        else invalid("Unsupported probe draft action: " + action);
    }
    auto value = V::obj();
    value.object["result"] = V::boolean(result);
    value.object["snapshot"] = draft(session);
    return value;
}
V command(DocumentSession& session, const V& args) {
    const auto commandId = string(args, "commandId");
    if (commandId != "territorial.field") invalid("The probe supports the territorial.field command.");
    const auto& payload = field(args, "payload");
    if (string(payload, "field") != "name") invalid("The probe supports the territorial name field.");
    CommandArguments arguments;
    arguments.action = TerritorialFieldEdit{territorialRef(string(payload, "id")), TerritorialField::Name,
        string(payload, "value")};
    const auto& inputTargets = field(args, "targets");
    if (inputTargets.kind != V::Array) invalid("Command targets must be an array.");
    std::vector<ObjectRef> targets;
    for (const auto& target : inputTargets.array) targets.push_back({string(target, "domain"), string(target, "id")});
    return outcome(session.executeCommand(commandId, std::move(arguments), std::move(targets),
        handle(args, "expectedEpoch")), session);
}
V dispatch(DocumentSession& session, const std::string& op, const V& args) {
    if (op == "documentLoad") return state(session.documentLoad(string(args, "json"), string(args, "month")));
    if (op == "storageBaselineLoad") return state(session.storageBaselineLoad(
        source(field(args, "source")), handle(args, "expectedEpoch")));
    if (op == "documentLoadBaseline") return state(session.documentLoadBaseline(
        handle(args, "storageBaselineId"), field(args, "setup"), string(args, "documentId")));
    if (op == "projectState") return state(session.projectState());
    if (op == "documentSnapshot") return V::str(session.documentSnapshot());
    if (op == "storageSnapshot") return V::str(session.storageSnapshot());
    if (op == "resolveWorld") {
        const auto epoch = handle(args, "expectedEpoch");
        session.requireEpoch(epoch);
        auto value = world(session.resolveWorld(string(args, "month")));
        value.object["sourceEpoch"] = number(epoch);
        return value;
    }
    if (op == "setTimelineCursor") {
        ResolvedWorld resolved;
        session.setTimelineCursor(string(args, "month"), handle(args, "expectedEpoch"), &resolved);
        const auto current = session.projectState();
        auto value = V::obj(), projected = world(resolved);
        projected.object["sourceEpoch"] = number(current.epoch);
        value.object["state"] = state(current);
        value.object["selection"] = selection(session.selection());
        value.object["world"] = std::move(projected);
        return value;
    }
    if (op == "temporalSourcePrepare") {
        const auto receipt = session.temporalSourcePrepare(source(field(args, "source")),
            string(args, "dataRevision"), string(args, "manifestSha256"), handle(args, "expectedEpoch"));
        auto value = V::obj();
        value.object["sourceId"] = number(receipt.sourceId);
        value.object["sourceMonth"] = V::str(receipt.sourceMonth);
        value.object["fingerprint"] = V::str(receipt.fingerprint);
        value.object["reused"] = V::boolean(receipt.reused);
        return value;
    }
    if (op == "temporalSourceStats") {
        const auto stats = session.temporalSourceStats();
        auto value = V::obj();
        value.object["entries"] = number(stats.entries);
        value.object["declaredDecodedBytes"] = number(stats.declaredDecodedBytes);
        value.object["hits"] = number(stats.hits);
        value.object["evictions"] = number(stats.evictions);
        return value;
    }
    if (op == "temporalSourceRelease") return V::boolean(session.temporalSourceRelease(
        handle(args, "sourceId"), handle(args, "expectedEpoch")));
    if (op == "temporalCandidatePrepare") {
        const auto& input = optionalField(args, "setup");
        const auto receipt = session.temporalCandidatePrepare(handle(args, "sourceId"), string(args, "targetMonth"),
            string(args, "sourceFingerprint"), handle(args, "expectedEpoch"),
            input.kind == V::Null ? std::nullopt : std::optional<V>{input}, optionalString(args, "documentId"));
        auto value = V::obj();
        value.object["candidateId"] = number(receipt.candidateId);
        value.object["sourceId"] = number(receipt.sourceId);
        value.object["expectedEpoch"] = number(receipt.expectedEpoch);
        value.object["targetMonth"] = V::str(receipt.targetMonth);
        value.object["sourceFingerprint"] = V::str(receipt.sourceFingerprint);
        value.object["worldSha256"] = V::str(receipt.worldSha256);
        value.object["resolvedEntityCount"] = number(receipt.resolvedEntityCount);
        value.object["reused"] = V::boolean(receipt.reused);
        return value;
    }
    if (op == "temporalCandidateInspect") {
        const auto inspected = session.temporalCandidateInspect(handle(args, "candidateId"), handle(args, "expectedEpoch"));
        if (!inspected) return {};
        auto value = V::obj();
        value.object["project"] = codecjson::parse(inspected->projectedJson);
        value.object["world"] = world(inspected->world);
        return value;
    }
    if (op == "temporalCandidateDiscard") return V::boolean(session.temporalCandidateDiscard(
        handle(args, "candidateId"), handle(args, "expectedEpoch")));
    if (op == "temporalCandidateAdopt") {
        std::string delta;
        const auto adopted=session.temporalCandidateAdopt(
            handle(args, "candidateId"), handle(args, "sourceId"), string(args, "targetMonth"),
            string(args, "sourceFingerprint"), string(args, "worldSha256"), handle(args, "replacementId"),
            handle(args, "expectedEpoch"),&delta);
        auto value=V::obj();value.object["state"]=state(adopted);
        value.object["delta"]=delta.empty()?V{}:codecjson::parse(delta);
        return value;
    }
    if (op == "captureReplacement") return number(session.captureReplacement(handle(args, "expectedEpoch")));
    if (op == "rollbackReplacement") return state(session.rollbackReplacement(handle(args, "id"), handle(args, "expectedEpoch")));
    if (op == "releaseReplacement") return V::boolean(session.releaseReplacement(handle(args, "id")));
    if (op == "command") return command(session, args);
    if (op == "undo") return outcome(session.undo(handle(args, "expectedEpoch")), session);
    if (op == "redo") return outcome(session.redo(handle(args, "expectedEpoch")), session);
    if (op == "selectionSnapshot") { session.projectState(); return selection(session.selection()); }
    if (op == "selectionApply") return applySelection(session, args);
    if (op == "draftSnapshot") return draft(session);
    if (op == "draftApply") return applyDraft(session, args);
    invalid("Unknown probe operation: " + op);
}
std::string errorCode(const std::exception& error) {
    if (const auto* timeline = dynamic_cast<const TimelineError*>(&error)) return timeline->code;
    const std::string message = error.what();
    if (message.rfind("INVALID_DATE:", 0) == 0) return "PL-TEMPORAL-001";
    auto code = message.substr(0, message.find(':'));
    if (code.empty() || !std::all_of(code.begin(), code.end(), [](char ch) {
        return (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-';
    })) return "CORE_SESSION_ERROR";
    return code;
}
} // namespace

int main() {
    std::ios::sync_with_stdio(false);
    auto session = std::make_unique<DocumentSession>(ports);
    std::string line;
    while (std::getline(std::cin, line)) {
        auto response = V::obj();
        try {
            const auto request = codecjson::parse(line);
            const auto op = string(request, "op");
            if (op == "dispose") {
                session.reset();
                response.object["result"] = V{};
            } else {
                if (!session) throw TimelineError("PL-CORE-DISPOSED", "The temporal parity session is disposed.");
                response.object["result"] = dispatch(*session, op, optionalField(request, "args"));
            }
            response.object["ok"] = V::boolean(true);
        } catch (const std::exception& error) {
            auto failure = V::obj();
            failure.object["code"] = V::str(errorCode(error));
            failure.object["message"] = V::str(error.what());
            response.object["ok"] = V::boolean(false);
            response.object["error"] = std::move(failure);
        }
        std::cout << response.encode() << '\n' << std::flush;
    }
    return std::cin.bad() ? 1 : 0;
}
