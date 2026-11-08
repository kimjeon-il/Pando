/** Transient desktop menu presentation state; project settings live elsewhere. */
export function createMapDisplayMenuState(){
  let path=[],layout=null,gesture=null,pendingLayout=false,focusedControl=null;
  let openTimer=null,closeTimer=null;
  const originals=new Map();
  function cancelOpenTimer(){clearTimeout(openTimer);openTimer=null;}
  function cancelCloseTimer(){clearTimeout(closeTimer);closeTimer=null;}
  function cancelTimers(){cancelOpenTimer();cancelCloseTimer();}
  return Object.freeze({
    get path(){return path;},
    setPath(next){path=[...next];},
    popPath(){return path.pop();},
    get layout(){return layout;},setLayout(value){layout=value;},
    get pendingLayout(){return pendingLayout;},setPendingLayout(value){pendingLayout=!!value;},
    get gesture(){return gesture;},
    beginGesture(pointerId){gesture=pointerId;cancelTimers();},
    endGesture(pointerId){if(gesture!==pointerId)return false;gesture=null;return true;},
    get focusedControl(){return focusedControl;},rememberFocus(element){focusedControl=element;},
    originals,
    cancelTimers,cancelOpenTimer,cancelCloseTimer,
    scheduleOpen(callback,delay=150){cancelTimers();openTimer=setTimeout(()=>{openTimer=null;callback();},delay);},
    scheduleClose(callback,delay=200){cancelTimers();closeTimer=setTimeout(()=>{closeTimer=null;callback();},delay);},
  });
}
