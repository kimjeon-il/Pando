// Bookkeeping only: model state remains in the native checkpoint.
export function accumulateEpochLoss(previous,epoch,loss){
  if(!Number.isSafeInteger(epoch)||epoch<0||!Number.isFinite(loss))throw Error('Finite epoch and batch loss required');
  if(!previous||previous.epoch!==epoch)return {epochLossSum:loss,epochLossCount:1};
  if(!Number.isFinite(previous.epochLossSum)||!Number.isSafeInteger(previous.epochLossCount)||previous.epochLossCount<1)
    return {epochLossSum:null,epochLossCount:null};
  const sum=previous.epochLossSum+loss,count=previous.epochLossCount+1;
  if(!Number.isFinite(sum)||!Number.isSafeInteger(count))throw Error('Epoch loss accumulation exceeds range');
  return {epochLossSum:sum,epochLossCount:count};
}
export function decideTrainingEpoch(receipt,{validationLoss=null,bestScore=null,stale=0,patience}={}){
  if(!receipt||!Number.isSafeInteger(receipt.epoch)||receipt.epoch<0||!Number.isSafeInteger(receipt.orderLength)||receipt.orderLength<1||
    !Number.isSafeInteger(receipt.cursor)||receipt.cursor!==receipt.orderLength||
    !Number.isFinite(receipt.epochLossSum)||!Number.isSafeInteger(receipt.epochLossCount)||receipt.epochLossCount<1)
    throw Error('Complete epoch loss history required');
  if((validationLoss!==null&&!Number.isFinite(validationLoss))||(bestScore!==null&&!Number.isFinite(bestScore))||
    !Number.isSafeInteger(stale)||stale<0||!Number.isSafeInteger(patience)||patience<1)throw Error('Invalid training selection state');
  const trainingLoss=receipt.epochLossSum/receipt.epochLossCount,score=validationLoss===null?trainingLoss:validationLoss;
  const improved=bestScore===null||score<bestScore,newStale=improved?0:stale+1;
  return {trainingLoss,validationLoss,score,improved,bestScore:improved?score:bestScore,stale:newStale,
    stop:validationLoss!==null&&newStale>=patience};
}
