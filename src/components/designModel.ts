import type { DesignComponent, DesignModel, DesignNode, DesignValue, PatchOp, Properties } from '../api/design'
export function walkNodes(model:DesignModel):DesignNode[]{
 const out:DesignNode[]=[]
 const walk=(n:DesignNode)=>{out.push(n);for(const c of n.children??[])walk(c)}
 for(const s of model.screens)walk(s.root)
 for(const c of model.components)walk(c.root)
 return out
}
export function initialDesign(uuid:()=>string=()=>crypto.randomUUID()):DesignModel{
 const node=(type:DesignNode['type'],props:Properties,children:DesignNode[]=[]):DesignNode=>({id:uuid(),type,props,children})
 const color=uuid(),spacing=uuid(),typography=uuid(),component=uuid()
 return {schema:'rivet.design/v1',base:null,overrides:[],tokens:[{id:color,name:'Акцент',type:'color',value:{hex:'#3498db'}},{id:spacing,name:'Отступ',type:'spacing',value:{px:16}},{id:typography,name:'Основной текст',type:'typography',value:{font_family:'sans-serif',font_size:16,font_weight:400,line_height:1.5}}],components:[{id:component,name:'Основная кнопка',root:node('button',{text:'Продолжить',background:{token_id:color},color:'#ffffff',padding:12,radius:8}),variants:[{state:'default',props:{}},{state:'disabled',props:{disabled:true}}]}],screens:[{id:uuid(),name:'Первый экран',viewport:{width:1024,height:768},root:node('container',{padding:{token_id:spacing},gap:16,direction:'column',background:'#ffffff'},[node('text',{text:'Новый продукт',typography:{token_id:typography},color:'#17212b'}),{...node('instance',{}),component_id:component}])}]}
}
// Client preview only. Server validates every patch again, including shared
// impact, references and revision. Unsupported operations are never dropped.
export function applyDesignPatch(model:DesignModel,ops:PatchOp[]):DesignModel{
 const m=structuredClone(model)
 for(const op of ops){
  const nodes=walkNodes(m)
  if(op.op==='set_token'){const t=m.tokens.find(t=>t.id===op.token_id);if(!t)throw Error('Токен отсутствует');t.value=structuredClone(op.value)}
  else if(op.op==='set_property'){const n=nodes.find(n=>n.id===op.element_id);if(!n)throw Error('Элемент отсутствует');n.props[op.property]=structuredClone(op.value);if(n.type==='instance'){m.overrides=m.overrides.filter(o=>!(o.instance_id===n.id&&o.property===op.property));m.overrides.push({instance_id:n.id,property:op.property,value:structuredClone(op.value)})}}
  else if(op.op==='update_component'){const i=m.components.findIndex(c=>c.id===op.component_id);if(i<0)throw Error('Компонент отсутствует');m.components[i]=structuredClone(op.component)}
  else if(op.op==='update_base')m.base=structuredClone(op.base)
  else if(op.op==='add_node'){const p=nodes.find(n=>n.id===op.parent_id);if(!p)throw Error('Родитель отсутствует');p.children.splice(op.index,0,structuredClone(op.node))}
  else if(op.op==='remove_node'){const p=nodes.find(n=>n.children.some(c=>c.id===op.element_id));if(!p)throw Error('Корень экрана нельзя удалить');p.children=p.children.filter(c=>c.id!==op.element_id)}
 }
 return m
}
export function componentOf(model:DesignModel,id:string):DesignComponent|undefined{return model.components.find(c=>{const visit=(n:DesignNode):boolean=>n.id===id||n.children.some(visit);return visit(c.root)})}
export function componentProperty(model:DesignModel,id:string,property:string,value:DesignValue):PatchOp{
 const c=componentOf(model,id);if(!c)throw Error('Выберите элемент компонента')
 const component=structuredClone(c),walk=(n:DesignNode)=>{if(n.id===id)n.props[property]=value;for(const child of n.children)walk(child)};walk(component.root)
 return {op:'update_component',component_id:c.id,component}
}
// Byte-identical platform code is permitted by both the parent response CSP and
// the opaque srcdoc CSP. Keep the hash in sync with rivet/internal/webui.CSP.
export const DESIGN_PREVIEW_SCRIPT = "(function(){'use strict';var config=document.body.dataset;function send(type,element){parent.postMessage({type:type,channel_nonce:config.channelNonce,document_id:config.documentId,revision:Number(config.revision),element_id:element},'*')}document.addEventListener('click',function(event){event.preventDefault();var target=event.target instanceof Element?event.target:null;var node=target&&target.closest('[data-element]');if(node)send('select',node.getAttribute('data-element'))});document.addEventListener('keydown',function(event){if(event.key==='Enter'&&event.target instanceof HTMLElement){event.preventDefault();event.target.click()}});send('ready')})()"
export const DESIGN_PREVIEW_SCRIPT_HASH = 'sha256-G1oTaUgBWCiHlmC7lbR+nvCWXc1B/gjzwMgpimcARI0='
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const safeColor=(v:unknown)=>typeof v==='string'&&/^#[0-9a-f]{3,8}$/i.test(v)?v:null
const number=(v:unknown,min=0,max=4096)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):null
const families=['sans-serif','serif','monospace','Arial','Inter','Roboto','system-ui']
export function renderDesignPreview(model:DesignModel,root:DesignNode,documentId:string,revision:number,nonce:string,selected:string,state='default',assets:Record<string,string>={}):string{
 const resolve=(v:DesignValue|undefined,field:string):unknown=>v&&typeof v==='object'?model.tokens.find(t=>t.id===v.token_id)?.value[field]:v
 const css=(p:Properties)=>{
  const out:string[]=['box-sizing:border-box']
  for(const [key,prop]of [['color','color'],['background','background'],['border_color','border-color']]){const v=safeColor(resolve(p[key],'hex'));if(v)out.push(`${prop}:${v}`)}
  for(const [key,prop]of [['padding','padding'],['gap','gap'],['width','width'],['height','height'],['radius','border-radius'],['border','border-width'],['font_size','font-size']]){const v=number(resolve(p[key],'px'));if(v!==null)out.push(`${prop}:${v}px`)}
  if(p.border)out.push('border-style:solid')
  const align={start:'flex-start',center:'center',end:'flex-end',stretch:'stretch'}[String(p.alignment)];if(align)out.push(`align-items:${align}`)
  if(p.direction==='row'||p.direction==='column')out.push(`display:flex;flex-direction:${p.direction}`)
  const typography=p.typography&&typeof p.typography==='object'?model.tokens.find(t=>t.id===(p.typography as {token_id:string}).token_id)?.value:undefined
  const family=String(typography?.font_family??p.font_family??'');if(families.includes(family))out.push(`font-family:${family}`)
  const fs=number(typography?.font_size??p.font_size,8,256);if(fs!==null)out.push(`font-size:${fs}px`)
  const fw=number(typography?.font_weight??p.font_weight,100,900);if(fw!==null)out.push(`font-weight:${fw}`)
  const lh=number(typography?.line_height??p.line_height,.5,5);if(lh!==null)out.push(`line-height:${lh}`)
  return out.join(';')
 }
 const assetOrigins=new Set<string>()
 const draw=(n:DesignNode,ancestors:Set<string>=new Set(),instanceId?:string):string=>{
  if(ancestors.size>32)return ''
  if(n.type==='instance'){
   const c=model.components.find(c=>c.id===n.component_id)
   if(!c||ancestors.has(c.id))return '<span>Компонент недоступен</span>'
   const next=new Set(ancestors);next.add(c.id)
   const overrides=Object.fromEntries(model.overrides.filter(o=>o.instance_id===n.id).map(o=>[o.property,o.value]))
   return draw({...c.root,props:{...c.root.props,...c.variants.find(v=>v.state===state)?.props,...n.props,...overrides}},next,n.id)
  }
  const id=instanceId??n.id,p=n.props,tag=n.type==='text'?'span':n.type==='button'?'button':n.type==='input'?'input':n.type==='image'?'img':'div'
  const attrs=` data-element="${escape(id)}" tabindex="0" style="${escape(css(p))}${selected===id?';outline:2px solid #3498db':''}"`
  if(tag==='img'){
   const raw=assets[String(p.asset_id)];let url:URL|null=null
   try{url=raw?new URL(raw,globalThis.location?.origin??'http://localhost'):null}catch{/* Invalid scoped URL renders an inert placeholder. */}
   if(!url||!['https:','http:'].includes(url.protocol))return `<span${attrs}>Изображение ${escape(p.asset_id??'не выбрано')}</span>`
   assetOrigins.add(url.origin);return `<img${attrs} src="${escape(url.href)}" alt="${escape(p.text??'')}" crossorigin="anonymous">`
  }
  if(tag==='input')return `<input${attrs} placeholder="${escape(p.placeholder??p.text??'')}" readonly>`
  return `<${tag}${attrs}${p.disabled?' disabled':''}>${escape(p.text??'')}${n.children.map(c=>draw(c,ancestors)).join('')}</${tag}>`
 }
 const content=draw(root),origins=[...assetOrigins].join(' ')
 // Only platform-owned code executes. No imported code, raw CSS, event
 // attributes, external scripts or session access enter this opaque frame.
 return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${DESIGN_PREVIEW_SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src ${escape(origins||"'none'")}; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>body{margin:0;font:16px sans-serif;color:#17212b;background:white}button,input{font:inherit}*[data-element]{cursor:pointer}input{min-height:32px}</style></head><body data-channel-nonce="${escape(nonce)}" data-document-id="${escape(documentId)}" data-revision="${Number(revision)}">${content}<script>${DESIGN_PREVIEW_SCRIPT}</script></body></html>`
}
export function previewSelection(data:unknown,nonce:string,documentId:string,revision:number,model:DesignModel):string|null{
 if(!data||typeof data!=='object')return null
 const m=data as Record<string,unknown>
 if(m.type!=='select'||m.channel_nonce!==nonce||m.document_id!==documentId||m.revision!==revision||typeof m.element_id!=='string')return null
 return walkNodes(model).some(n=>n.id===m.element_id)?m.element_id:null
}

// Coalesce only adjacent changes with the same target. Structural ordering
// remains intact, while typing does not exhaust the 100-operation API limit.
export function appendDesignPatch(operations:PatchOp[],operation:PatchOp):PatchOp[]{
 const last=operations.at(-1)
 const same=last?.op===operation.op&&(
  last.op==='set_property'&&operation.op==='set_property'&&last.element_id===operation.element_id&&last.property===operation.property||
  last.op==='set_token'&&operation.op==='set_token'&&last.token_id===operation.token_id||
  last.op==='update_component'&&operation.op==='update_component'&&last.component_id===operation.component_id)
 return same?[...operations.slice(0,-1),operation]:[...operations,operation]
}
