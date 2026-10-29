#include "training-checkpoint.h"
#include <torch/torch.h>
#include <iostream>
#include <stdexcept>

void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
struct SampleModelImpl:torch::nn::Module {
    torch::nn::Linear encoder{nullptr},head{nullptr};
    SampleModelImpl(){encoder=register_module("encoder",torch::nn::Linear(4,4));head=register_module("head",torch::nn::Linear(4,1));}
    torch::Tensor forward(const torch::Tensor& input){return head->forward(torch::relu(encoder->forward(input)));}
};
TORCH_MODULE(SampleModel);
void update(SampleModel& model,torch::optim::AdamW& optimizer){
    auto input=torch::randn({5,4}),target=torch::randn({5,1});
    optimizer.zero_grad();auto loss=(model->forward(input)-target).square().mean();loss.backward();optimizer.step();
}
int main(){
    try{
        torch::set_num_threads(2);torch::manual_seed(711);
        SampleModel first;first->train();first->encoder->eval();
        for(auto& parameter:first->encoder->parameters())parameter.requires_grad_(false);
        torch::optim::AdamW initial(first->parameters(),torch::optim::AdamWOptions(.001));
        update(first,initial);
        const pando::reference::SamplingState sample{3,2,77,{4,8,8,1,9}};
        const auto bytes=pando::reference::saveTrainingCheckpoint(*first,initial,sample,torch::Device(torch::kCPU));
        update(first,initial);const auto expectedWeight=first->head->weight.detach().clone(),expectedBias=first->head->bias.detach().clone();
        SampleModel resumed;torch::optim::AdamW restored(resumed->parameters(),torch::optim::AdamWOptions(.001));
        const auto loaded=pando::reference::loadTrainingCheckpoint(*resumed,restored,bytes,torch::Device(torch::kCPU));
        check(loaded.epoch==3&&loaded.cursor==2&&loaded.seed==77&&loaded.order==sample.order,"Sampling state was not restored");
        check(resumed->is_training()&&!resumed->encoder->is_training()&&resumed->head->is_training(),"Training/evaluation modes were not restored");
        for(const auto& parameter:resumed->encoder->parameters())check(!parameter.requires_grad(),"Frozen parameter was not restored");
        update(resumed,restored);
        check(torch::equal(resumed->head->weight.detach(),expectedWeight)&&torch::equal(resumed->head->bias.detach(),expectedBias),"Resumed AdamW and RNG update differs");
        bool rejected=false;try{
            SampleModel invalid;torch::optim::AdamW broken(invalid->parameters(),torch::optim::AdamWOptions(.001));
            pando::reference::loadTrainingCheckpoint(*invalid,broken,bytes.substr(0,bytes.size()/2),torch::Device(torch::kCPU));
        }catch(const std::exception&){rejected=true;}
        check(rejected,"Truncated checkpoint was accepted");
        rejected=false;try{
            auto invalid=sample;invalid.cursor=invalid.order.size()+1;
            pando::reference::saveTrainingCheckpoint(*first,initial,invalid,torch::Device(torch::kCPU));
        }catch(const std::exception&){rejected=true;}
        check(rejected,"Out-of-range sampling cursor was accepted");
        std::cout<<"Model, AdamW, RNG and sampling resume exactly on CPU\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
