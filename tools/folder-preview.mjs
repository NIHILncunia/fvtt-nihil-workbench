// 읽기 전용 코어 사본의 실제 color-picker와 저장소의 폼·CSS를 쓰는 격리 검증 서버.
// Foundry 서버·월드에는 접속하지 않으며 생성 결과는 브라우저 메모리에만 남는다.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const core = await readFile(process.argv[2], 'utf8');
const slice = (
  start,
  end,
) => core.slice(core.indexOf(start), core.indexOf(end, core.indexOf(start)));
const elements = [
  slice('class AdoptableHTMLElement extends', 'class HTMLSecretBlockElement extends'),
  slice('class AbstractFormInputElement extends', 'function createFormGroup('),
  slice('class HTMLColorPickerElement extends', 'class HTMLRangePickerElement extends'),
  "customElements.define('color-picker', HTMLColorPickerElement);",
].join('\n');
const page = `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>폴더 격리 검증</title>
<link rel="stylesheet" href="/styles/workbench.css">
<style>
body { margin: 0; padding: 24px; font-family: Arial, sans-serif; background: #151515; color: #eee; }
body.light { background: #e8e5df; color: #222; }
nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
button { cursor: pointer; }
form.application { margin: 0 auto; border: 1px solid #655a47; border-radius: 6px; overflow: hidden; }
.window-header { display:flex; align-items:center; padding: 12px; background:#29241d; color:#eee7da; gap:8px; }
.window-header h1 { font-size: 14px; margin:0; flex:1; }
.window-header button { width:32px; }
.window-content { overflow:hidden; }
* { box-sizing:border-box; }
@media(max-width:480px) { body { padding:8px; } }
</style>
<nav><button id="create">아이템 생성</button><button id="scene">씬 생성</button><button id="edit">폴더 편집</button><button id="theme">밝기 전환</button></nav>
<output id="result" aria-live="polite"></output><main></main>
<script src="/handlebars.js"></script><script src="/core-elements.js"></script>
<script type="module" src="/preview-client.js"></script></html>`;
const client = `
class FolderConfig {}
class ApplicationV2 {
  constructor(options = {}) {
    this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options,
      classes: [...this.constructor.DEFAULT_OPTIONS.classes, ...(options.classes ?? [])] };
  }
  async render() {
    const context = await this._prepareContext();
    const template = await (await fetch('/templates/workbench/document-workbench.hbs')).text();
    const form = document.createElement('form');
    form.className = ['application', ...this.options.classes].join(' ');
    form.style.width = (this.options.position.width ?? 640) + 'px';
    form.innerHTML = '<header class="window-header"><h1></h1><button type="button" data-close>×</button></header><div class="window-content">' + Handlebars.compile(template)(context) + '</div>';
    form.querySelector('h1').textContent = this.options.window.title;
    this.element?.remove(); this.element = form;
    document.querySelector('main').append(form);
    form.addEventListener('submit', (event) => this.constructor.DEFAULT_OPTIONS.form.handler.call(this, event));
    form.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (target) this.constructor.DEFAULT_OPTIONS.actions[target.dataset.action]?.call(this, event, target);
      if (event.target.closest('[data-close]')) this.close();
    });
    window.app = this;
    return this;
  }
  async close() { this.element?.remove(); return this; }
}
globalThis.foundry = { applications: { api: { ApplicationV2, HandlebarsApplicationMixin: (base) => base, DialogV2: { confirm: async () => true } }, sheets: { FolderConfig } } };
globalThis.game = { user: { id:'isolated', role:4, isGM:true }, packs: new Map() };
globalThis.writes = [];
globalThis.ui = { notifications: Object.fromEntries(['error','info','warn'].map((kind) => [kind, (message) => { document.querySelector('#result').textContent = message; window.lastNotification = {kind,message}; }])) };
class Folder {
  static defaultName() { return '새 폴더'; }
  static canUserCreate(user) { return user.isGM; }
  static async create(data, options) { const folder = {...data, id:'isolated-folder'}; writes.push({data,options}); return folder; }
  constructor(data) { this.source = {color:null, ...data}; this.schema = { fields: { name:{}, color:{nullable:true}, sorting:{choices:{a:'이름순',m:'수동 정렬'}} } }; }
  toObject() { return structuredClone(this.source); }
  _getSheetClass() { return FolderConfig; }
}
globalThis.CONFIG = {Folder:{documentClass:Folder}};
const {openFolderWorkbench} = await import('/scripts/workbench/folder-workbench.mjs');
const {editDocument} = await import('/scripts/workbench/document-workbench-app.mjs');
window.openCreate = (type='Item') => { document.querySelector('main').replaceChildren(); return openFolderWorkbench({data:{type, folder:null, color:'#665d49'}}); };
document.querySelector('#create').onclick = () => openCreate();
document.querySelector('#scene').onclick = () => openCreate('Scene');
document.querySelector('#edit').onclick = () => {
  document.querySelector('main').replaceChildren();
  const source = {name:'빈 색상 폴더', color:null, folder:null, sorting:'a', flags:{other:{color:'문자열 유지'}}};
  const doc = { documentName:'Folder', name:source.name, schema:new Folder({}).schema, toObject:()=>source, update:async(patch)=>{writes.push({patch}); return doc;} };
  return editDocument(doc,{roots:['name','color','folder','sorting','flags']});
};
document.querySelector('#theme').onclick = () => document.body.classList.toggle('light');
await openCreate().renderPromise;
window.previewReady = true;
`;
const server = createServer(async (
  request,
  response,
) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  try {
    let body;
    if (path === '/') body = page;
    else if (path === '/core-elements.js') body = elements;
    else if (path === '/preview-client.js') body = client;
    else if (path === '/handlebars.js') body = await readFile(resolve(root, 'node_modules/handlebars/dist/handlebars.js'));
    else {
      const target = resolve(root, '.' + decodeURIComponent(path));
      if (!target.startsWith(root + sep)) throw new Error('outside root');
      body = await readFile(target);
    }
    response.writeHead(200, { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : path.endsWith('.css') ? 'text/css' : path.endsWith('.hbs') ? 'text/plain; charset=utf-8' : 'text/javascript' });
    response.end(body);
  } catch {
    response.writeHead(404); response.end();
  }
});
server.listen(8794, '127.0.0.1', () => console.log('Isolated folder preview: http://127.0.0.1:8794'));
