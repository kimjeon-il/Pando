#include "boundary-loss.h"
#include <torch/torch.h>
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {
void check(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
void close(double actual,double expected,double tolerance,const char* message){
    if(!std::isfinite(actual)||std::abs(actual-expected)>tolerance)throw std::runtime_error(message);
}
}
int main(){
    try{
        torch::set_num_threads(2);
        auto logits=torch::zeros({1,7,12,12},torch::TensorOptions().dtype(torch::kFloat32).requires_grad(true));
        auto target=torch::zeros_like(logits);target.index_put_({torch::indexing::Slice(),torch::indexing::Slice(),torch::indexing::Slice(5,7),torch::indexing::Slice()},1);
        auto valid=torch::ones({1,1,12,12});
        auto loss=pando::reference::boundaryLoss(logits,target,valid);loss.backward();
        close(loss.item<double>(),1.4681425094604492,2e-6,"Broadcast loss differs from the original");
        close(logits.grad().abs().sum().item<double>(),0.709199070930481,2e-6,"Broadcast gradient differs from the original");
        auto explicitValid=valid.expand_as(logits).clone();explicitValid.index_put_({torch::indexing::Slice(),2},0);
        target.index_put_({torch::indexing::Slice(),2},1);logits.grad().zero_();
        auto masked=pando::reference::boundaryLoss(logits,target,explicitValid);masked.backward();
        close(masked.item<double>(),1.4678477048873901,2e-6,"Masked loss differs from the original");
        close(logits.grad().index({torch::indexing::Slice(),2}).abs().sum().item<double>(),0,1e-12,"Unobserved class received a gradient");
        close(logits.grad().index({torch::indexing::Slice(),0}).abs().sum().item<double>(),0.1253177672624588,2e-6,"Observed class gradient differs");
        const auto weights=torch::tensor({1.f,2.f,3.f,4.f,5.f,6.f,7.f});
        close(pando::reference::boundaryLoss(logits.detach(),target,explicitValid,weights).item<double>(),1.8336752653121948,2e-6,"Weighted loss differs from the original");
        check(pando::reference::boundaryLoss(logits.detach(),target,torch::zeros_like(explicitValid)).item<double>()==0,"Empty supervision must not create a loss");
        std::cout<<"Reference boundary loss and gradients match fixed Python cases\n";return 0;
    }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}
}
