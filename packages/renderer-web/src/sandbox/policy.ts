export function html(
  body: string,
  scripts: string[],
  css: string[],
  csp: string,
) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#root{width:100%;height:100%}*{box-sizing:border-box}</style>${css.map((path) => `<link rel="stylesheet" href="${path}">`).join('')}</head><body>${body}${scripts.map((path) => `<script src="${path}"></script>`).join('')}</body></html>`;
}
export const clockScript = `(()=>{let time=0;Object.defineProperty(globalThis,'__sceneTime',{get:()=>time,set:v=>{time=v}});const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...args){if(args.length)super(...args);else super(time)}static now(){return time}};Object.defineProperty(performance,'now',{value:()=>time});Object.defineProperty(performance,'timeOrigin',{value:0});crypto.getRandomValues=()=>{throw Error('Use SceneWire seeded random')};Math.random=()=>0.123456789;for(const api of ['setTimeout','setInterval','requestAnimationFrame','Worker','SharedWorker','WebSocket','EventSource'])globalThis[api]=()=>{throw Error('Uncontrolled API: '+api)};addEventListener('unhandledrejection',e=>console.error('Unhandled rejection: '+String(e.reason)));})();`;
