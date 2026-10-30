#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <stdexcept>

namespace pando::reference {
// MT19937 integer seeding and draws match CPython 3.12 random.Random for
// nonnegative integer seeds. Reference: CPython Modules/_randommodule.c,
// based on the MT19937 algorithm by Matsumoto and Nishimura.
class TrainingRandom {
    std::array<std::uint32_t,624> state{};std::size_t at=624;
public:
    explicit TrainingRandom(std::uint64_t seed){
        std::array<std::uint32_t,2> key{std::uint32_t(seed),std::uint32_t(seed>>32)};
        const std::size_t count=key[1]?2:1;state[0]=19650218U;
        for(std::size_t i=1;i<state.size();++i)state[i]=1812433253U*(state[i-1]^(state[i-1]>>30))+std::uint32_t(i);
        std::size_t i=1,j=0;
        for(std::size_t k=std::max(state.size(),count);k;--k){state[i]=(state[i]^((state[i-1]^(state[i-1]>>30))*1664525U))+key[j]+std::uint32_t(j);
            if(++i>=state.size()){state[0]=state.back();i=1;}if(++j>=count)j=0;}
        for(std::size_t k=state.size()-1;k;--k){state[i]=(state[i]^((state[i-1]^(state[i-1]>>30))*1566083941U))-std::uint32_t(i);
            if(++i>=state.size()){state[0]=state.back();i=1;}}
        state[0]=0x80000000U;
    }
    std::uint32_t next(){
        if(at>=state.size()){
            for(std::size_t i=0;i<state.size();++i){const auto y=(state[i]&0x80000000U)|(state[(i+1)%state.size()]&0x7fffffffU);
                state[i]=state[(i+397)%state.size()]^(y>>1)^((y&1)?0x9908b0dfU:0U);}at=0;
        }
        auto y=state[at++];y^=y>>11;y^=(y<<7)&0x9d2c5680U;y^=(y<<15)&0xefc60000U;y^=y>>18;return y;
    }
    double uniform01(){const auto a=next()>>5,b=next()>>6;return (double(a)*67108864.0+double(b))/9007199254740992.0;}
    std::uint64_t below(std::uint64_t limit){
        if(!limit)throw std::invalid_argument("Random choice requires a nonempty range");
        unsigned bits=0;for(auto value=limit;value;value>>=1)++bits;
        std::uint64_t result;
        do{if(bits<=32)result=next()>>(32-bits);
           else{result=next();result|=std::uint64_t(next()>>(64-bits))<<32;}}
        while(result>=limit);return result;
    }
    unsigned choice3(){return static_cast<unsigned>(below(3));}
};
struct ScanConditions {bool grayscale;double contrast,brightness,saturation,resolution,blur;int quality;};
inline ScanConditions trainingScanConditions(std::uint64_t epoch,std::uint64_t index){
    if(epoch>(std::numeric_limits<std::uint64_t>::max()-20261024U)/1000003U||
       index>std::numeric_limits<std::uint64_t>::max()-20261024U-epoch*1000003U)throw std::invalid_argument("Training condition seed exceeds range");
    TrainingRandom random(20261024U+epoch*1000003U+index);
    const bool gray=random.uniform01()<.25;const double contrast=.75+(.25+.25)*random.uniform01();
    const double brightness=.85+(1.1-.85)*random.uniform01(),saturation=.5+(1.3-.5)*random.uniform01();
    constexpr double resolutions[]={.5,.75,1},blurs[]={0,.25,.5};constexpr int qualities[]={55,75,95};
    const auto resolution=resolutions[random.choice3()],blur=blurs[random.choice3()];const auto quality=qualities[random.choice3()];
    return {gray,contrast,brightness,saturation,resolution,blur,quality};
}
}
