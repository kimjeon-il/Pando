// Read-only Windows file identity/allocation audit. No filesystem mutations.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <pandoeditor/losslessjson.h>
#include <algorithm>
#include <cstdint>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <map>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>

namespace fs=std::filesystem;
using Value=pandoeditor::codecjson::Value;
namespace {
[[noreturn]] void winError(const char* operation){throw std::runtime_error(std::string(operation)+" failed, Win32 error "+std::to_string(GetLastError()));}
struct Handle {
    HANDLE value=INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE input):value(input){if(value==INVALID_HANDLE_VALUE)winError("CreateFileW");}
    ~Handle(){if(value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    Handle(const Handle&)=delete;Handle& operator=(const Handle&)=delete;
};
const Value& field(const Value& value,const char* key){
    if(value.kind!=Value::Object)throw std::invalid_argument("Expected manifest object");
    const auto it=value.object.find(key);if(it==value.object.end())throw std::invalid_argument(std::string("Missing field: ")+key);return it->second;
}
std::wstring text(const Value& value){
    if(value.kind!=Value::String)throw std::invalid_argument("Expected path/action string");
    const auto& data=value.string;const int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,data.data(),static_cast<int>(data.size()),nullptr,0);
    if(size<=0)throw std::invalid_argument("Invalid UTF-8 path/action");
    std::wstring result(size,L'\0');
    if(MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,data.data(),static_cast<int>(data.size()),result.data(),size)!=size)winError("MultiByteToWideChar");
    if(result.find(L'\0')!=std::wstring::npos)throw std::invalid_argument("NUL in path/action");return result;
}
std::wstring normalText(std::wstring path){
    std::replace(path.begin(),path.end(),L'/',L'\\');
    if(path.rfind(L"\\\\?\\UNC\\",0)==0)path=L"\\\\"+path.substr(8);
    else if(path.rfind(L"\\\\?\\",0)==0)path=path.substr(4);
    return path;
}
std::wstring folded(std::wstring value){for(auto& c:value)c=static_cast<wchar_t>(std::towlower(c));return value;}
std::wstring extended(const fs::path& path){const auto value=path.native();return value.rfind(L"\\\\",0)==0?L"\\\\?\\UNC\\"+value.substr(2):L"\\\\?\\"+value;}
void noReparse(const fs::path& path){
    fs::path current=path.root_path();
    for(const auto& part:path.relative_path()){
        current/=part;const DWORD attributes=GetFileAttributesW(extended(current).c_str());
        if(attributes==INVALID_FILE_ATTRIBUTES)winError("GetFileAttributesW");
        if(attributes&FILE_ATTRIBUTE_REPARSE_POINT)throw std::runtime_error("Reparse point must be preserved");
    }
}
fs::path selectedPath(const Value& entry){
    const auto root=fs::absolute(fs::path(normalText(text(field(entry,"root"))))).lexically_normal();
    const auto relative=fs::path(normalText(text(field(entry,"path"))));
    if(relative.empty()||relative.has_root_name()||relative.has_root_directory())throw std::invalid_argument("Selected path must be relative");
    for(const auto& part:relative)if(part==L"..")throw std::invalid_argument("Selected path escapes its root");
    const auto path=(root/relative).lexically_normal();
    auto a=root.begin(),b=path.begin();
    for(;a!=root.end();++a,++b)if(b==path.end()||folded(a->native())!=folded(b->native()))throw std::invalid_argument("Selected path escapes its root");
    if(b==path.end())throw std::invalid_argument("Selected path must name a file");
    noReparse(path);return path;
}
Value number(std::uint64_t value){Value out;out.kind=Value::Number;out.raw=std::to_string(value);return out;}
struct Group {std::uint64_t allocated=0,links=0,selected=0,deleted=0;};
Value audit(const Value& manifest){
    const auto& entries=field(manifest,"entries");if(entries.kind!=Value::Array)throw std::invalid_argument("Expected entries array");
    std::map<std::string,Group> groups;std::set<std::wstring> paths;
    for(const auto& entry:entries.array){
        const auto action=text(field(entry,"action"));if(action!=L"delete"&&action!=L"relocate")throw std::invalid_argument("Invalid cleanup action");
        const auto path=selectedPath(entry);
        Handle file(CreateFileW(extended(path).c_str(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_BACKUP_SEMANTICS,nullptr));
        BY_HANDLE_FILE_INFORMATION info{};if(!GetFileInformationByHandle(file.value,&info))winError("GetFileInformationByHandle");
        if(info.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))throw std::runtime_error("Only regular files may be audited");
        noReparse(path);
        const DWORD length=GetFinalPathNameByHandleW(file.value,nullptr,0,FILE_NAME_NORMALIZED);
        if(!length)winError("GetFinalPathNameByHandleW");
        std::wstring finalPath(length,L'\0');const DWORD used=GetFinalPathNameByHandleW(file.value,finalPath.data(),length,FILE_NAME_NORMALIZED);
        if(!used||used>=length)winError("GetFinalPathNameByHandleW");finalPath.resize(used);
        if(!paths.insert(folded(normalText(finalPath))).second)throw std::invalid_argument("Duplicate selected path");
        FILE_STANDARD_INFO standard{};if(!GetFileInformationByHandleEx(file.value,FileStandardInfo,&standard,sizeof(standard)))winError("FileStandardInfo");
        if(standard.AllocationSize.QuadPart<0||standard.DeletePending)throw std::runtime_error("File changed during allocation audit");
        std::uint64_t allocated=static_cast<std::uint64_t>(standard.AllocationSize.QuadPart);
        if(info.dwFileAttributes&(FILE_ATTRIBUTE_COMPRESSED|FILE_ATTRIBUTE_SPARSE_FILE)){
            FILE_COMPRESSION_INFO compression{};if(!GetFileInformationByHandleEx(file.value,FileCompressionInfo,&compression,sizeof(compression)))winError("FileCompressionInfo");
            if(compression.CompressedFileSize.QuadPart<0)throw std::runtime_error("Invalid compressed allocation");allocated=static_cast<std::uint64_t>(compression.CompressedFileSize.QuadPart);
        }
        const std::string key=std::to_string(info.dwVolumeSerialNumber)+":"+std::to_string(info.nFileIndexHigh)+":"+std::to_string(info.nFileIndexLow);
        auto [it,inserted]=groups.try_emplace(key,Group{allocated,standard.NumberOfLinks,0,0});auto& group=it->second;
        if(!inserted&&(group.allocated!=allocated||group.links!=standard.NumberOfLinks))throw std::runtime_error("Hardlink metadata changed during allocation audit");
        ++group.selected;if(action==L"delete")++group.deleted;
    }
    std::uint64_t selected=0,reclaimable=0,deleted=0,shared=0;
    for(const auto& [key,group]:groups){
        selected+=group.allocated;if(group.selected>=group.links)reclaimable+=group.allocated;else shared+=group.allocated;
        if(group.deleted>=group.links)deleted+=group.allocated;
    }
    auto out=Value::obj();out.object={{"files",number(entries.array.size())},{"uniqueFileIds",number(groups.size())},
        {"selectedUniqueAllocation",number(selected)},{"reclaimableAllocation",number(reclaimable)},
        {"deleteOnlyReclaimableAllocation",number(deleted)},{"sharedWithUnselectedAllocation",number(shared)},
        {"note",Value::str("NTFS primary streams, file-ID deduplicated; excludes metadata and alternate streams")}};return out;
}
}
int wmain(int argc,wchar_t** argv){
    try{
        if(argc!=2)throw std::invalid_argument("Usage: pando-pc-file-allocation MANIFEST_JSON");
        std::ifstream stream(fs::path(argv[1]),std::ios::binary);if(!stream)throw std::runtime_error("Cannot read allocation manifest");
        const std::string bytes{std::istreambuf_iterator<char>(stream),std::istreambuf_iterator<char>()};
        std::cout<<audit(pandoeditor::codecjson::parse(bytes)).encode()<<'\n';return 0;
    }catch(const std::exception& error){std::cerr<<"PC allocation audit: "<<error.what()<<'\n';return 1;}
}
