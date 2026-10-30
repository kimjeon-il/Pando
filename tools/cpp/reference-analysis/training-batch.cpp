// Low-level private training batch engine. Admission and dataset ownership are
// handled by the caller; this executable never approves or publishes a model.
#include "reference-io.h"
#include "safetensors.h"
#include "training-ordered-step.h"
#include "training-amp.h"
#include "training-validation.h"
#include "training-sampling.h"
#include "training-supervision.h"
#include <ATen/Context.h>
#include <cmath>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

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
pando::reference::TrainingBatch readSample(const fs::path& dir){
  return {pando::reference::readFloatTensor(dir/"tile.f32",{1,3,512,512}),pando::reference::readFloatTensor(dir/"overview.f32",{1,3,256,256}),
    pando::reference::readFloatTensor(dir/"position.f32",{1,4}),pando::reference::readFloatTensor(dir/"target.f32",{1,7,512,512}),
    pando::reference::readFloatTensor(dir/"valid.f32",{1,7,512,512})};
}
void checkSupervision(const pando::reference::TrainingBatch& batch){
  if(batch.target.min().item<float>()<0||batch.target.max().item<float>()>1||batch.valid.min().item<float>()<0||batch.valid.max().item<float>()>1||batch.valid.sum().item<double>()==0)
    throw std::invalid_argument("Training batch requires valid supervision");
}
int balancedOrder(const std::vector<fs::path>& args){
  if(args.size()!=4)throw std::invalid_argument("Expected order EPOCH SEED");
  const auto epoch=integer(args[2]),seed=integer(args[3]);
  const auto readNumber=[](){unsigned char bytes[4];if(!std::cin.read(reinterpret_cast<char*>(bytes),4))throw std::runtime_error("Truncated training order input");
    return std::uint32_t(bytes[0])|(std::uint32_t(bytes[1])<<8)|(std::uint32_t(bytes[2])<<16)|(std::uint32_t(bytes[3])<<24);};
  const auto count=readNumber();if(count<1||count>64)throw std::invalid_argument("Invalid training corpus count");
  std::vector<std::vector<std::string>> datasets;datasets.reserve(count);std::size_t total=0,largest=0,bytesRead=0;
  for(std::uint32_t i=0;i<count;++i){const auto size=readNumber();if(!size||size>1000000-total)throw std::invalid_argument("Invalid training tile count");
    total+=size;std::vector<std::string> rows;rows.reserve(size);std::set<std::string> groups;
    for(std::uint32_t j=0;j<size;++j){const auto length=readNumber();if(!length||length>1024||length>64*1024*1024-bytesRead)throw std::invalid_argument("Invalid training group length");
      bytesRead+=length;std::string value(length,'\0');if(!std::cin.read(value.data(),length))throw std::runtime_error("Truncated training group");
      if(value.find('\0')!=std::string::npos)throw std::invalid_argument("Invalid training group");groups.insert(value);rows.push_back(std::move(value));}
    largest=std::max(largest,groups.size());datasets.push_back(std::move(rows));}
  if(std::cin.peek()!=std::char_traits<char>::eof())throw std::invalid_argument("Trailing training order bytes");
  const auto quota=std::max((total+count-1)/count,largest);if(quota>1000000/count)throw std::invalid_argument("Training order exceeds budget");
  const auto order=pando::reference::balancedTrainingOrder(datasets,epoch,seed);
  for(const auto value:order)for(unsigned shift=0;shift<64;shift+=8)std::cout.put(static_cast<char>((value>>shift)&255));
  if(!std::cout)throw std::runtime_error("Unable to write training order");return 0;
}
torch::Tensor readStreamTensor(const std::vector<std::int64_t>& shape){std::int64_t elements=1;for(const auto size:shape)elements*=size;
  auto tensor=torch::empty(shape,torch::kFloat32);const auto length=elements*static_cast<std::int64_t>(sizeof(float));
  if(!std::cin.read(static_cast<char*>(tensor.data_ptr()),static_cast<std::streamsize>(length)))throw std::runtime_error("Truncated reference tensor stream");
  if(!torch::isfinite(tensor).all().item<bool>())throw std::runtime_error("Reference tensor contains nonfinite values");return tensor;}
int infer(const std::vector<fs::path>& args){
  if(args.size()!=5||(args[4]!=fs::path("logits")&&args[4]!=fs::path("probabilities")))throw std::invalid_argument("Expected inference DEVICE MODEL logits|probabilities");
  torch::set_num_threads(2);
  const auto device=pando::reference::selectDevice(args[2].string());const bool initializer=args[1]==fs::path("infer-weights");
  const auto bytes=pando::reference::readBounded(args[3],initializer?256ULL*1024*1024:1024ULL*1024*1024);
  pando::reference::ReferenceBoundaryModel model;
  if(initializer){const auto metadata=pando::reference::loadSafetensors(*model,bytes);const auto architecture=metadata.find("architecture"),scope=metadata.find("trainingOnly");
    if(architecture==metadata.end()||architecture->second!="mobilenetv3-unet-context-v1"||scope==metadata.end()||scope->second!="true")
      throw std::invalid_argument("A private training-only reference initializer is required");model->to(device);
  }else{model->to(device);torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4));
    pando::reference::loadTrainingCheckpoint(*model,optimizer,std::string(bytes.begin(),bytes.end()),device);}
  const auto tile=readStreamTensor({1,3,512,512}).to(device),overview=readStreamTensor({1,3,256,256}).to(device),position=readStreamTensor({1,4}).to(device);
  if(std::cin.peek()!=std::char_traits<char>::eof())throw std::invalid_argument("Trailing reference tensor bytes");
  model->eval();torch::NoGradGuard guard;auto output=model->forward(tile,overview,position);
  if(args[4]==fs::path("probabilities"))output=output.sigmoid();
  output=output.to(torch::kCPU).contiguous();
  if(output.sizes()!=torch::IntArrayRef({1,7,512,512})||!torch::isfinite(output).all().item<bool>())throw std::runtime_error("Checkpoint inference returned invalid logits");
  std::cout.write(static_cast<const char*>(output.data_ptr()),static_cast<std::streamsize>(output.numel()*sizeof(float)));
  if(!std::cout)throw std::runtime_error("Unable to write checkpoint logits");return 0;
}
int validate(const std::vector<fs::path>& args){
  if(args.size()!=5)throw std::invalid_argument("Expected validate DEVICE CHECKPOINT SAMPLE_COUNT");
  const auto count=integer(args[4]);if(count<1||count>100000)throw std::invalid_argument("Invalid validation sample count");
  const auto device=pando::reference::selectDevice(args[2].string());const auto bytes=pando::reference::readBounded(args[3],1024ULL*1024*1024);
  pando::reference::ReferenceBoundaryModel model;model->to(device);torch::optim::AdamW optimizer(model->parameters(),torch::optim::AdamWOptions(1e-4));
  pando::reference::loadTrainingCheckpoint(*model,optimizer,std::string(bytes.begin(),bytes.end()),device);
  double sum=0;for(std::int64_t i=0;i<count;++i){pando::reference::TrainingBatch batch{readStreamTensor({1,3,512,512}),readStreamTensor({1,3,256,256}),
      readStreamTensor({1,4}),readStreamTensor({1,7,512,512}),readStreamTensor({1,7,512,512})};checkSupervision(batch);
    batch={batch.tile.to(device),batch.overview.to(device),batch.position.to(device),batch.target.to(device),batch.valid.to(device)};
    sum+=pando::reference::validationBatchLoss(model,batch);}
  if(std::cin.peek()!=std::char_traits<char>::eof())throw std::invalid_argument("Trailing validation tensor bytes");
  std::cout<<std::setprecision(17)<<"{\"trainingOnly\":true,\"releaseApproved\":false,\"independentEvaluation\":false,\"samples\":"
    <<count<<",\"loss\":"<<sum/double(count)<<"}\n";return 0;
}
int run(const std::vector<fs::path>& args){
  if(args.size()>1&&args[1]==fs::path("order"))return balancedOrder(args);
  if(args.size()>1&&(args[1]==fs::path("infer")||args[1]==fs::path("infer-weights")))return infer(args);
  if(args.size()>1&&args[1]==fs::path("validate"))return validate(args);
  if(args.size()<17||(args.size()-15)%2||args.size()>47)throw std::invalid_argument("Expected DEVICE warm|resume INPUT OUTPUT EPOCH SEED FREEZE_EPOCHS LEARNING_RATE ORDER WEIGHTS|none PRECISION SCALE GROWTH UNOBSERVED_MASK INDEX SAMPLE_DIR...");
  const auto mode=args[2].string();if(mode!="warm"&&mode!="resume")throw std::invalid_argument("Training mode must be warm or resume");
  if(fs::exists(args[4]))throw std::invalid_argument("Checkpoint output exists; preserve it");
  const auto epoch=integer(args[5]),seed=integer(args[6]),freezeEpochs=integer(args[7]),unobservedMask=integer(args[14]);const auto rate=learningRate(args[8]);
  if(unobservedMask>127)throw std::invalid_argument("Invalid unobserved channel mask");
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
    pando::reference::initializeUnobservedChannels(model,static_cast<std::uint32_t>(unobservedMask));
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
  const auto precision=args[11].string();if(precision!="fp32"&&precision!="amp-fp16")throw std::invalid_argument("Invalid training precision");
  if(precision=="amp-fp16"&&!device.is_cuda())throw std::invalid_argument("AMP training requires CUDA");
  std::size_t scaleUsed=0;const auto scaleText=args[12].string();const double scaleValue=std::stod(scaleText,&scaleUsed);const auto growth=integer(args[13]);
  if(scaleUsed!=scaleText.size()||!std::isfinite(scaleValue)||scaleValue<=0||scaleValue>std::numeric_limits<float>::max()||growth>=2000)
    throw std::invalid_argument("Invalid training AMP state");
  pando::reference::TrainingAmpState ampState{static_cast<float>(scaleValue),static_cast<std::int32_t>(growth)};
  std::vector<torch::Tensor> tiles,overviews,positions,targets,valids;std::vector<std::int64_t> indices;
  for(std::size_t i=15;i<args.size();i+=2){indices.push_back(integer(args[i]));const auto sample=readSample(args[i+1]);
    tiles.push_back(sample.tile);overviews.push_back(sample.overview);positions.push_back(sample.position);targets.push_back(sample.target);valids.push_back(sample.valid);}
  pando::reference::TrainingBatch batch{torch::cat(tiles).to(device),torch::cat(overviews).to(device),torch::cat(positions).to(device),torch::cat(targets).to(device),torch::cat(valids).to(device)};
  checkSupervision(batch);
  double loss=0;bool applied=true;
  if(precision=="amp-fp16"){const auto result=pando::reference::orderedTrainingAmpStep(model,optimizer,batch,state,indices,ampState,positiveWeight);loss=result.loss;applied=result.applied;}
  else loss=pando::reference::orderedTrainingBatchStep(model,optimizer,batch,state,indices,positiveWeight);
  const auto checkpoint=pando::reference::saveTrainingCheckpoint(*model,optimizer,state,device);pando::reference::writeNewFile(args[4],checkpoint);
  std::cout<<std::setprecision(17)<<"{\"trainingOnly\":true,\"releaseApproved\":false,\"precision\":\""<<precision<<"\",\"epoch\":"<<state.epoch
    <<",\"cursor\":"<<state.cursor<<",\"batch\":"<<indices.size()<<",\"loss\":"<<loss<<",\"applied\":"<<(applied?"true":"false")<<",\"ampScale\":";
  if(precision=="amp-fp16")std::cout<<ampState.scale;else std::cout<<"null";std::cout<<",\"ampGrowthTracker\":";
  if(precision=="amp-fp16")std::cout<<ampState.growthTracker;else std::cout<<"null";
  std::cout<<",\"checkpointBytes\":"<<checkpoint.size()<<"}\n";return 0;
}
}
#ifdef _WIN32
int wmain(int argc,wchar_t** argv){
#else
int main(int argc,char** argv){
#endif
  try{
#ifdef _WIN32
    if(_setmode(_fileno(stdin),_O_BINARY)==-1||_setmode(_fileno(stdout),_O_BINARY)==-1)throw std::runtime_error("Cannot set training stream binary mode");
#endif
    std::vector<fs::path> args;for(int i=0;i<argc;++i)args.emplace_back(argv[i]);return run(args);}
  catch(const std::exception& error){std::cerr<<"reference-training-batch: "<<error.what()<<'\n';return 1;}
}
