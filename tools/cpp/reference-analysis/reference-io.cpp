#include "reference-io.h"
#include <algorithm>
#include <cstring>
#include <fstream>
#include <limits>
#include <stdexcept>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>
#endif

namespace pando::reference {
std::vector<std::uint8_t> readBounded(const std::filesystem::path& path,std::uint64_t limit){
    const auto size=std::filesystem::file_size(path);if(size>limit)throw std::runtime_error("Reference input exceeds its size limit");
    std::vector<std::uint8_t> result(static_cast<size_t>(size));std::ifstream input(path,std::ios::binary);
    if(!input||!input.read(reinterpret_cast<char*>(result.data()),static_cast<std::streamsize>(result.size())))throw std::runtime_error("Cannot read reference input");
    return result;
}
torch::Tensor readFloatTensor(const std::filesystem::path& path,const std::vector<int64_t>& shape){
    std::uint64_t count=1;
    for(const auto n:shape){if(n<=0||count>std::numeric_limits<std::uint64_t>::max()/static_cast<std::uint64_t>(n))throw std::runtime_error("Invalid reference tensor shape");count*=n;}
    if(count>std::numeric_limits<std::uint64_t>::max()/4)throw std::runtime_error("Reference tensor is too large");
    const auto data=readBounded(path,count*4);if(data.size()!=count*4)throw std::runtime_error("Reference tensor has an incorrect byte length");
    auto result=torch::empty(shape,torch::TensorOptions().dtype(torch::kFloat32));std::memcpy(result.data_ptr(),data.data(),data.size());
    if(!torch::isfinite(result).all().item<bool>())throw std::runtime_error("Reference tensor contains nonfinite values");return result;
}
torch::Device selectDevice(const std::string& choice){
    torch::Device device(torch::kCPU);
    if(choice=="cuda"){
#ifdef _WIN32
        if(!LoadLibraryW(L"torch_cuda.dll"))throw std::runtime_error("Cannot load torch_cuda.dll, Win32 error "+std::to_string(GetLastError()));
#endif
        if(!torch::cuda::is_available())throw std::runtime_error("CUDA was requested but is unavailable");device=torch::Device(torch::kCUDA,0);
    }else if(choice!="cpu")throw std::runtime_error("Device must be cpu or cuda");
    torch::set_num_threads(2);return device;
}
void writeNewFile(const std::filesystem::path& path,const std::string& bytes){
#ifdef _WIN32
    const HANDLE handle=CreateFileW(path.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
    if(handle==INVALID_HANDLE_VALUE)throw std::runtime_error("Cannot create a new checkpoint, Win32 error "+std::to_string(GetLastError()));
    std::size_t offset=0;bool ok=true;
    while(offset<bytes.size()){
        const auto chunk=static_cast<DWORD>(std::min<std::size_t>(bytes.size()-offset,1U<<30));DWORD written=0;
        if(!WriteFile(handle,bytes.data()+offset,chunk,&written,nullptr)||written!=chunk){ok=false;break;}offset+=written;
    }
    if(!CloseHandle(handle))ok=false;if(!ok)throw std::runtime_error("Checkpoint write failed; preserve the partial new file");
#else
    const int handle=open(path.c_str(),O_WRONLY|O_CREAT|O_EXCL,0600);if(handle<0)throw std::runtime_error("Cannot create a new checkpoint");
    std::size_t offset=0;bool ok=true;
    while(offset<bytes.size()){
        const auto written=write(handle,bytes.data()+offset,bytes.size()-offset);
        if(written<0&&errno==EINTR)continue;if(written<=0){ok=false;break;}offset+=static_cast<std::size_t>(written);
    }
    if(close(handle)!=0)ok=false;if(!ok)throw std::runtime_error("Checkpoint write failed; preserve the partial new file");
#endif
}
}
