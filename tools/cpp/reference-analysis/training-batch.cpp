// Low-level private training batch engine. Admission and dataset ownership are
// handled by the caller; this executable never approves or publishes a model.
#include "reference-io.h"
#include "safetensors.h"
#include "training-ordered-step.h"
#include <ATen/Context.h>
#include <cmath>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace fs=std::filesystem;
namespace {
std::int64_t integer(const fs::path& path){const auto text=path.string();std::size_t used=0;
  if(text.empty()||text.find_first_not_of("0123456789")!=std::string::npos)throw std::invalid_argument("Expected nonnegative integer");
  const auto value=std::stoll(text,&used);if(used!=text.size())throw std::invalid_argument("Invalid integer");return value;}
double learningRate(const fs::path& path){const auto text=path.string();std::size_t used=0;const double value=std::stod(text,&used);
  if(used!=text.size()||!std::isfinite(value)||value<=0||value>.01)throw std::invalid_argument("Invalid learning rate");return value;}
std::vector<std::int64_t> orderFile(const fs::path& path){const auto bytes=pando::reference::readBounded(path,8ULL*1000000);
  if(bytes.empty()||bytes.size()%8)throw std::invalid_argument("Invalid training order file");std::vector<std::int64_t> result;result.reserve(bytes.size()/8);
  for(std::size_t at=0;at<bytes.size();at+=8){std::uint64_t value=0;for(unsigned i=0;i<8;++i)value|=std::uint64_t(bytes[at+i])<<(8*i);
    if(value>std::uint64_t(std::numeric_limits<std::int64_t>::max()))throw std::invalid_argument("Invalid training sample index");result.push_back(static_cast<std::int64_t>(value));}return result;}
void configure(pando::reference::ReferenceBoundaryModel& model,std::int64_t epoch,std::int64_t freezeEpochs){
  model->train();const bool frozen=epoch<freezeEpochs;for(auto& parameter:model->encoder->parameters())parameter.requires_grad_(!frozen);
  if(frozen)model->encoder->eval();
}
int run(const std::vector<fs::path>& args){
  if(args.size()<13||(args.size()-11)%2||args.size()>43)throw std::invalid_argument("Expected DEVICE warm|resume INPUT OUTPUT EPOCH SEED FREEZE_EPOCHS LEARNING_RATE ORDER WEIGHTS|none INDEX SAMPLE_DIR...");
  const auto mode=args[2].string();if(mode!="warm"&&mode!="resume")throw std::invalid_argument("Training mode must be warm or resume");
  if(fs::exists(args[4]))throw std::invalid_argument("Checkpoint output exists; preserve it");
  const auto epoch=integer(args[5]),seed=integer(args[6]),freezeEpochs=integer(args[7]);const auto rate=learningRate(args[8]);
  const auto order=orderFile(args[9]);const auto device=pando::reference::selectDevice(args[1].string());
  at::globalContext().setDeterministicAlgorithms(true,false);
  pando::reference::ReferenceBoundaryModel model;model->to(device);
  torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(rate).weight_decay(1e-4));
  pando::reference::SamplingState state;
  if(mode=="warm"){
    const auto source=pando::reference::readBounded(args[3],256ULL*1024*1024);const auto metadata=pando::reference::loadSafetensors(*model,source);
    const auto architecture=metadata.find("architecture"),scope=metadata.find("trainingOnly");
    if(architecture==metadata.end()||architecture->second!="mobilenetv3-unet-context-v1"||scope==metadata.end()||scope->second!="true")
      throw std::invalid_argument("A private training-only reference initializer is required");
    torch::manual_seed(20261022);if(device.is_cuda()){auto generator=at::globalContext().defaultGenerator(device);generator.set_current_seed(20261022);}
    state={epoch,0,seed,order};configure(model,epoch,freezeEpochs);
  }else{
    const auto bytes=pando::reference::readBounded(args[3],1024ULL*1024*1024);state=pando::reference::loadTrainingCheckpoint(*model,optimizer,std::string(bytes.begin(),bytes.end()),device);
    if(state.seed!=seed)throw std::invalid_argument("Training sampling seed differs from checkpoint");
    for(const auto& group:optimizer.param_groups())if(std::abs(static_cast<const torch::optim::AdamWOptions&>(group.options()).lr()-rate)>1e-15)
      throw std::invalid_argument("Learning rate differs from checkpoint");
    if(epoch==state.epoch){if(state.order!=order)throw std::invalid_argument("Training order differs from checkpoint");
      const bool frozen=epoch<freezeEpochs;if(model->encoder->is_training()==frozen)throw std::invalid_argument("Encoder mode differs from checkpoint");
      for(const auto& parameter:model->encoder->parameters())if(parameter.requires_grad()==frozen)throw std::invalid_argument("Encoder freeze differs from checkpoint");
    }else if(state.epoch<std::numeric_limits<std::int64_t>::max()&&epoch==state.epoch+1&&state.cursor==static_cast<std::int64_t>(state.order.size())){state={epoch,0,seed,order};configure(model,epoch,freezeEpochs);}
    else throw std::invalid_argument("Checkpoint is not at the requested epoch boundary");
  }
  c10::optional<torch::Tensor> positiveWeight=c10::nullopt;
  if(args[10]!=fs::path("none")){auto value=pando::reference::readFloatTensor(args[10],{7});
    if(value.min().item<float>()<1||value.max().item<float>()>64)throw std::invalid_argument("Positive weights must be within 1..64");positiveWeight=value.to(device);}
  std::vector<torch::Tensor> tiles,overviews,positions,targets,valids;std::vector<std::int64_t> indices;
  for(std::size_t i=11;i<args.size();i+=2){indices.push_back(integer(args[i]));const auto& dir=args[i+1];
    tiles.push_back(pando::reference::readFloatTensor(dir/"tile.f32",{1,3,512,512}));overviews.push_back(pando::reference::readFloatTensor(dir/"overview.f32",{1,3,256,256}));
    positions.push_back(pando::reference::readFloatTensor(dir/"position.f32",{1,4}));targets.push_back(pando::reference::readFloatTensor(dir/"target.f32",{1,7,512,512}));
    valids.push_back(pando::reference::readFloatTensor(dir/"valid.f32",{1,7,512,512}));}
  pando::reference::TrainingBatch batch{torch::cat(tiles).to(device),torch::cat(overviews).to(device),torch::cat(positions).to(device),torch::cat(targets).to(device),torch::cat(valids).to(device)};
  if(batch.target.min().item<float>()<0||batch.target.max().item<float>()>1||batch.valid.min().item<float>()<0||batch.valid.max().item<float>()>1||batch.valid.sum().item<double>()==0)
    throw std::invalid_argument("Training batch requires valid supervision");
  const auto loss=pando::reference::orderedTrainingBatchStep(model,optimizer,batch,state,indices,positiveWeight);
  const auto checkpoint=pando::reference::saveTrainingCheckpoint(*model,optimizer,state,device);pando::reference::writeNewFile(args[4],checkpoint);
  std::cout<<std::setprecision(17)<<"{\"trainingOnly\":true,\"releaseApproved\":false,\"precision\":\"fp32\",\"epoch\":"<<state.epoch
    <<",\"cursor\":"<<state.cursor<<",\"batch\":"<<indices.size()<<",\"loss\":"<<loss<<",\"checkpointBytes\":"<<checkpoint.size()<<"}\n";return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
#else
int main(int argc,char** argv){
#endif
  try{std::vector<fs::path> args;for(int i=0;i<argc;++i)args.emplace_back(argv[i]);return run(args);}
  catch(const std::exception& error){std::cerr<<"reference-training-batch: "<<error.what()<<'\n';return 1;}
}
