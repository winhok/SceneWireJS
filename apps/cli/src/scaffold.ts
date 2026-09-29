import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { installedEngineRegistry } from './director';
import { createEngineRegistry } from '@scenewirejs/director-core';
export async function scaffold(engineId: string, output: string) {
  const engine = installedEngineRegistry().getEngine(engineId);
  if (
    !engine?.scaffoldId ||
    engine.availability !== 'available' ||
    engine.authoringAvailability === 'incomplete'
  )
    throw new Error(
      `Engine scaffold unavailable. Missing authoring dependencies: ${engine?.missingAuthoringDependencies.join(' ') ?? engineId}. Install explicitly before scaffold.`,
    );
  return writeScaffold(engineId, output);
}
/** Writes starter code without installing; init reports preflight separately. */
export async function writeScaffold(engineId: string, output: string) {
  const engine = createEngineRegistry().getEngine(engineId);
  if (!engine?.scaffoldId) throw new Error('Engine scaffold unavailable');
  const header = `import type { WebComposition } from '@scenewirejs/web-runtime';\n`;
  const sources: Record<string, string> = {
    'web-dom':
      header +
      `let element: HTMLDivElement;\nexport default { mount(root) { element=document.createElement('div'); root.append(element); element.style.cssText='position:absolute;left:160px;top:280px;color:#fff;font:64px sans-serif'; element.textContent='Hello SceneWire'; }, seek(context) { element.style.transform=\`translateX(\${context.timeSeconds * 10}px)\`; } } satisfies WebComposition;\n`,
    'web-react':
      header +
      `import {createElement} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {flushSync} from 'react-dom';\nlet view: ReturnType<typeof createRoot>;\nexport default { mount(root) {view=createRoot(root);}, seek(context) {flushSync(()=>view.render(createElement('div',{style:{position:'absolute',left:160,top:280,color:'#fff',font:'64px sans-serif'}},'Hello SceneWire · '+context.frame)));}, dispose(){view.unmount();} } satisfies WebComposition;\n`,
    'web-pixi':
      header +
      `import 'pixi.js/unsafe-eval';
import {Application,Graphics,Ticker} from 'pixi.js';\nimport {createPixiFrameAdapter} from '@scenewirejs/web-runtime';\nexport default { async mount(root,init) {Ticker.system.autoStart=false;Ticker.system.stop();const app=new Application();await app.init({width:init.width,height:init.height,autoStart:false,sharedTicker:false,preference:'webgl'});root.append(app.canvas);const dot=new Graphics().circle(0,0,20).fill(0x66ddff);app.stage.addChild(dot);init.registerAdapter(createPixiFrameAdapter({app,update(c){dot.position.set(100+c.timeSeconds*10,100);},dispose(){app.destroy(true);}}));}, seek(){} } satisfies WebComposition;\n`,
    'web-three':
      header +
      `import {WebGLRenderer,Scene,PerspectiveCamera,Mesh,BoxGeometry,MeshNormalMaterial} from 'three';\nimport {createThreeFrameAdapter,withSeededLibraryRandom} from '@scenewirejs/web-runtime';\nexport default {mount(root,init){withSeededLibraryRandom(init.random,'three-init',()=>{const renderer=new WebGLRenderer({antialias:true});renderer.setSize(init.width,init.height);root.append(renderer.domElement);const scene=new Scene();const camera=new PerspectiveCamera(45,init.width/init.height,.1,100);camera.position.z=5;const geometry=new BoxGeometry();const material=new MeshNormalMaterial();const object=new Mesh(geometry,material);scene.add(object);init.registerAdapter(createThreeFrameAdapter({renderer,scene,camera,libraryRandom:init.random,update(c){object.rotation.y=c.timeSeconds;},dispose(){geometry.dispose();material.dispose();renderer.dispose();}}));});},seek(){} } satisfies WebComposition;\n`,
  };
  // Exclusive directory creation prevents overwrite, including symlink destinations.
  await mkdir(output);
  try {
    await writeFile(
      join(output, 'composition.json'),
      JSON.stringify(
        {
          schemaVersion: 2,
          renderer: 'web',
          engine: engineId,
          entry: './index.ts',
          transparent: true,
          permissions: { network: false },
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
    await writeFile(join(output, 'index.ts'), sources[engineId]!, {
      flag: 'wx',
    });
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  return { engine: engineId, renderer: engine.rendererId, output };
}
