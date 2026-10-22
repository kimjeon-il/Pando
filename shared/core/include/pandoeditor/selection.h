#pragma once
#include <pandoeditor/selectionref.h>
#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace pandoeditor {
// Session state only: this class cannot access a Project or a ChangeSet.
// Reference: world-map 58e4087, object-selection-controller.js.
class SelectionState {
public:
    const std::vector<SelectionRef>& items() const noexcept { return items_; }
    const std::optional<SelectionRef>& primary() const noexcept { return primary_; }
    std::uint64_t revision() const noexcept { return revision_; }
    std::uint64_t hoverRevision() const noexcept { return hoverRevision_; }
    const std::optional<SelectionRef>& hover() const noexcept { return hover_; }
    const std::string& hoverSource() const noexcept { return hoverSource_; }
    // True means accepted. An accepted same-reference hover may update its
    // source without changing the hover revision.
    bool setHover(std::optional<SelectionRef> ref,const std::string& source={},const std::string& expectedKey={}) {
        if(!ref&&((!source.empty()&&!hoverSource_.empty()&&source!=hoverSource_)
            ||(!expectedKey.empty()&&(!hover_||selectionRefKey(*hover_)!=expectedKey))))return false;
        if(ref&&!valid(*ref))return false;
        if(hover_==ref){if(ref)hoverSource_=source;return true;}
        hover_=std::move(ref);hoverSource_=hover_?source:std::string{};++hoverRevision_;return true;
    }
    bool has(const SelectionRef& ref) const { return contains(items_,ref); }
    std::optional<SelectionRef> rangeAnchor(const std::string& scope) const {
        const auto it=anchors_.find(scope);
        return it==anchors_.end()?std::optional<SelectionRef>{}:it->second;
    }
    bool replace(const SelectionRef& ref,const std::string& scope={}) {
        if(!valid(ref)) return false;
        if(!scope.empty()) anchors_[scope]=ref;
        return apply({ref},ref);
    }
    bool toggle(const SelectionRef& ref,const std::string& scope={}) {
        if(!valid(ref)) return false;
        auto next=items_; auto primary=primary_;
        const auto it=std::find(next.begin(),next.end(),ref);
        if(it==next.end()) { next.push_back(ref); primary=ref; }
        else {
            next.erase(it);
            if(primary && *primary==ref) primary=last(next);
        }
        if(!scope.empty()) anchors_[scope]=ref;
        return apply(std::move(next),std::move(primary));
    }
    bool selectRange(const SelectionRef& ref,const std::vector<SelectionRef>& ordered,
                     const std::string& scope="default",bool additive=false) {
        if(!valid(ref)) return false;
        std::vector<SelectionRef> values;
        for(const auto& value:ordered) if(valid(value)) values.push_back(value);
        const auto target=std::find(values.begin(),values.end(),ref);
        if(target==values.end()) return false;
        const auto anchor=rangeAnchor(scope);
        const auto start=anchor?std::find(values.begin(),values.end(),*anchor):values.end();
        auto next=additive?items_:std::vector<SelectionRef>{};
        if(start==values.end()) append(next,ref);
        else {
            const auto low=std::min(start,target), high=std::max(start,target);
            for(auto it=low;it!=high+1;++it) append(next,*it);
        }
        anchors_[scope]=ref;
        return apply(std::move(next),ref);
    }
    bool setMany(const std::vector<SelectionRef>& refs,
                 std::optional<SelectionRef> requestedPrimary={},const std::string& scope={}) {
        std::vector<SelectionRef> next;
        std::optional<SelectionRef> fallback;
        for(const auto& ref:refs) if(valid(ref)) { append(next,ref); fallback=ref; }
        // Web fallback is the LAST INPUT, not the last unique insertion.
        const auto primary=requestedPrimary && contains(next,*requestedPrimary)?requestedPrimary:fallback;
        if(!scope.empty() && primary) anchors_[scope]=*primary;
        return apply(std::move(next),primary);
    }
    bool remove(const SelectionRef& ref) {
        auto next=items_;
        const auto it=std::find(next.begin(),next.end(),ref);
        if(it==next.end()) return false;
        next.erase(it);
        auto primary=primary_;
        if(primary && *primary==ref) primary=last(next);
        return apply(std::move(next),std::move(primary));
    }
    bool prune(const std::function<bool(const SelectionRef&)>& exists) {
        std::vector<SelectionRef> next;
        for(const auto& ref:items_) if(exists(ref)) next.push_back(ref);
        auto primary=primary_;
        if(primary && !contains(next,*primary)) primary=last(next);
        // The web reducer deliberately retains scope anchors on prune.
        const auto changed=apply(std::move(next),std::move(primary));
        if(hover_&&!exists(*hover_))setHover({});
        return changed;
    }
    bool clear() {
        if(items_.empty() && !primary_) return false;
        anchors_.clear();
        return apply({},{});
    }
    // Current Web history restores clear selected objects, while hover remains
    // unless its reference no longer exists. No-op history never calls this.
    void documentHistoryApplied(const std::function<bool(const SelectionRef&)>& exists) {
        clear();prune(exists);
    }
    void reset() { items_.clear();primary_.reset();anchors_.clear();hover_.reset();hoverSource_.clear();revision_=0;hoverRevision_=0; }
    void resetProject() {
        clear();setHover({});
    }
private:
    static bool valid(const SelectionRef& ref) {
        static const std::set<std::string> domains={"territorial","distributionLayer","distributionEntry","generic","hydro","hydroBuiltin","placeBuiltin","label"};
        const bool accepted=!ref.id.empty()&&!ref.type.empty()&&domains.count(ref.domain)!=0
            &&(ref.domain!="territorial"||ref.type=="entity");
        if(accepted)(void)selectionRefKey(ref);
        return accepted;
    }
    static bool contains(const std::vector<SelectionRef>& refs,const SelectionRef& ref) {
        return std::find(refs.begin(),refs.end(),ref)!=refs.end();
    }
    static void append(std::vector<SelectionRef>& refs,const SelectionRef& ref) {
        if(!contains(refs,ref)) refs.push_back(ref);
    }
    static std::optional<SelectionRef> last(const std::vector<SelectionRef>& refs) {
        return refs.empty()?std::optional<SelectionRef>{}:refs.back();
    }
    bool apply(std::vector<SelectionRef> refs,std::optional<SelectionRef> primary) {
        if(items_==refs && primary_==primary) return false;
        items_=std::move(refs); primary_=std::move(primary); ++revision_; return true;
    }
    std::vector<SelectionRef> items_;
    std::optional<SelectionRef> primary_;
    std::map<std::string,SelectionRef> anchors_;
    std::uint64_t revision_=0;
    std::optional<SelectionRef> hover_;
    std::string hoverSource_;
    std::uint64_t hoverRevision_=0;
};
} // namespace pandoeditor
