#include <cstdlib>
#include <fstream>
#include <iostream>
int main(int argc,char** argv){
    const auto* log=std::getenv("PANDO_DENIED_TOOL_LOG");
    if(log){std::ofstream out(log,std::ios::app);for(int i=0;i<argc;++i)out<<argv[i]<<' ';out<<'\n';}
    std::cerr<<"P6_FORBIDDEN_BUILD_TOOL: "<<(argc?argv[0]:"interpreter")<<'\n';
    return 97;
}
