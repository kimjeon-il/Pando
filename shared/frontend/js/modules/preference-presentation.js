import {loadUserPreferences,saveUserPreferences,effectiveTheme} from './user-preferences.js';
import {applyAppAccent} from './app-accent.js';
import {resolveMapInteractionStyle,applyInteractionCssProperties} from './map-interaction-style.js';

const FONT_STACKS=Object.freeze({default:'var(--ui-font-family)',gothic:'"Pretendard Variable", Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif',serif:'"Noto Serif KR", "Nanum Myeongjo", "AppleMyungjo", serif'});

/** Owns preference state and its DOM projection for both products. */
export function createPreferencePresentation({document,window,productMode,onChange=()=>{}}){
  if (!['viewer', 'editor'].includes(productMode)) throw new TypeError('Preference product mode is required.');
  let current=loadUserPreferences(),accent,interactionStyle;
  const systemThemeQuery=window.matchMedia('(prefers-color-scheme: dark)');
  let systemTheme=systemThemeQuery.matches?'dark':'light';
  function render(){
    const root=document.documentElement,theme=effectiveTheme(current,systemTheme==='dark');
    root.dataset.systemTheme=systemTheme;root.dataset.theme=theme;
    root.dataset.statusBarVisible=String(productMode==='editor'&&current.appearance.statusBarVisible);
    root.dataset.smoothLines=String(current.appearance.smoothLines);
    const status=document.getElementById('mapBottomStatus');if(status)status.hidden=!current.appearance.statusBarVisible;
    accent=applyAppAccent(document,current.appearance.accentPreset);
    for(const kind of ['country','place']){
      const labels=current.labels[kind];root.style.setProperty(`--${kind}-label-font-family`,FONT_STACKS[labels.font]||FONT_STACKS.default);
      const key=`--${kind}-label-color`;if(labels.color)root.style.setProperty(key,labels.color);else root.style.removeProperty(key);
    }
    if(current.labels.place.pointColor)root.style.setProperty('--place-label-point-color',current.labels.place.pointColor);else root.style.removeProperty('--place-label-point-color');
    const computed=window.getComputedStyle(root);
    interactionStyle=resolveMapInteractionStyle({theme,selectionColor:current.selection.color||accent,outlineVisible:current.selection.outlineVisible,
      fillStrength:current.selection.fillStrength,antiAlias:current.appearance.smoothLines,
      tokens:{accent:computed.getPropertyValue('--accent').trim(),textStrong:computed.getPropertyValue('--text-strong').trim()}});
    applyInteractionCssProperties(interactionStyle);window.__PANDOLAB_THEME__=theme;window.__PANDOLAB_INTERACTION_STYLE__=interactionStyle;
  }
  function apply(next,{persist=true,rerender=true,reason='user-preferences'}={}){
    current=persist?saveUserPreferences(next):next;render();onChange({reason,rerender,interactionStyle});return current;
  }
  function applySystemTheme(matchesDark){systemTheme=matchesDark?'dark':'light';apply(current,{persist:false,reason:'system-theme'});}
  const onSystemTheme=event=>applySystemTheme(event.matches);
  render();systemThemeQuery.addEventListener('change',onSystemTheme);
  return Object.freeze({apply,applySystemTheme,render,dispose:()=>systemThemeQuery.removeEventListener('change',onSystemTheme),
    get current(){return current;},set current(value){current=value;},get accent(){return accent;},get interactionStyle(){return interactionStyle;},
    get systemTheme(){return systemTheme;},systemThemeQuery});
}
