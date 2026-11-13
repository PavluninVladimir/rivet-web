import { ApiError, request } from './client.ts'
export type DesignValue=string|number|boolean|{token_id:string}|null
export type Properties=Record<string,DesignValue>
export interface DesignNode {id:string;type:'container'|'text'|'button'|'input'|'image'|'instance';props:Properties;children:DesignNode[];component_id?:string}
export interface DesignToken {id:string;name:string;type:'color'|'typography'|'spacing';value:Record<string,string|number>}
export interface DesignComponent {id:string;name:string;root:DesignNode;variants:{state:'default'|'hover'|'focus'|'disabled'|'error';props:Properties}[]}
export interface BaseRef {document_id:string;revision:number;content_sha:string}
export interface DesignModel {schema:'rivet.design/v1';tokens:DesignToken[];components:DesignComponent[];screens:{id:string;name:string;viewport:{width:number;height:number};root:DesignNode}[];base:BaseRef|null;overrides:{instance_id:string;property:string;value:DesignValue}[]}
export interface DesignDocument {id:string;project_id:string;name:string;revision:number;content_sha:string;created_by:string;updated_at:string;base:BaseRef|null}
export interface Diagnostic {code:string;path:string;message:string}
export type PatchOp={op:'set_property';element_id:string;property:string;value:DesignValue;scope:'instance'}|{op:'set_token';token_id:string;value:DesignToken['value']}|{op:'update_component';component_id:string;component:DesignComponent}|{op:'update_base';base:BaseRef|null}|{op:'add_node';parent_id:string;node:DesignNode;index:number}|{op:'remove_node';element_id:string}
export interface DesignDiff {base_revision:number;operations:PatchOp[];affected_element_ids:string[];conflicts:Diagnostic[]}
export interface DesignRevision {revision:number;parent_revision:number|null;content_sha:string;actor_id:string;created_at:string;diff:DesignDiff}
export interface DesignComment {id:string;revision:number;author_id:string;text:string;created_at:string;edited_at:string|null;deleted:boolean}
export interface DesignThread {id:string;revision:number;anchor:{document_id:string;revision:number;element_id:string;property?:string};status:'open'|'resolved';orphaned:boolean;created_by:string;created_at:string;messages:DesignComment[]}
export interface DesignAsset {id:string;sha256:string;mime:string;size_bytes:number;url?:string}
export interface DesignHandoff {id:string;project_id:string;document_id:string;revision:number;model_sha:string;manifest_sha:string;screenshot_asset_id:string;asset_refs:DesignAsset[];threads_snapshot:DesignThread[];context_refs:{kind:string;id:string}[];git_commit_sha:string|null;created_at:string}
export interface DocumentView {document:DesignDocument;model:DesignModel}
const root=(p:string)=>`/projects/${encodeURIComponent(p)}/design`
const doc=(p:string,id:string)=>`${root(p)}/documents/${encodeURIComponent(id)}`
const mutation=<T>(method:string,path:string,body:unknown,key:string=crypto.randomUUID())=>request<T>(method,path,body,undefined,{'Idempotency-Key':key})
export const designApi={
 documents:(p:string)=>request<{items:DesignDocument[];next_cursor:string|null}>('GET',`${root(p)}/documents?limit=100`),
 create:(p:string,name:string,model:DesignModel)=>mutation<DesignDocument>('POST',`${root(p)}/documents`,{name,model}),
 get:(p:string,id:string,revision?:number)=>request<DocumentView>('GET',doc(p,id)+(revision?'?revision='+revision:'')),
 patch:(p:string,id:string,revision:number,operations:PatchOp[],key:string)=>mutation<{document:DesignDocument;diff:DesignDiff}>('PATCH',doc(p,id),{expected_revision:revision,operations},key),
 diff:(p:string,id:string,revision:number,operations:PatchOp[])=>mutation<DesignDiff>('POST',doc(p,id)+'/preview-diff',{expected_revision:revision,operations}),
 revisions:(p:string,id:string)=>request<{items:DesignRevision[];next_cursor:string|null}>('GET',doc(p,id)+'/revisions?limit=100'),
 undo:(p:string,id:string,revision:number,undo:number)=>mutation<{document:DesignDocument;diff:DesignDiff}>('POST',doc(p,id)+'/undo',{expected_revision:revision,undo_revision:undo}),
 validateImport:(p:string,id:string|null,model:unknown,assets:DesignAsset[])=>mutation<{valid:boolean;diagnostics:Diagnostic[];impact:DesignDiff|null}>('POST',root(p)+'/imports/validate',{document_id:id,model,assets}),
 import:(p:string,id:string,revision:number,model:DesignModel,assets:DesignAsset[])=>mutation<DesignDocument>('POST',doc(p,id)+'/import',{expected_revision:revision,model,assets}),
 export:(p:string,id:string,revision:number)=>request<unknown>('GET',doc(p,id)+'/export?revision='+revision),
 threads:(p:string,id:string)=>request<{items:DesignThread[];next_cursor:string|null}>('GET',doc(p,id)+'/threads?limit=100'),
 thread:(p:string,id:string,anchor:DesignThread['anchor'],text:string)=>mutation<DesignThread>('POST',doc(p,id)+'/threads',{anchor,text}),
 reply:(p:string,id:string,text:string)=>mutation<DesignComment>('POST',`${root(p)}/threads/${id}/messages`,{text}),
 threadStatus:(p:string,t:DesignThread,status:DesignThread['status'])=>mutation<DesignThread>('PATCH',`${root(p)}/threads/${t.id}`,{expected_revision:t.revision,status}),
 editComment:(p:string,c:DesignComment,text:string)=>mutation<DesignComment>('PATCH',`${root(p)}/comments/${c.id}`,{expected_revision:c.revision,text}),
 deleteComment:(p:string,c:DesignComment)=>mutation<DesignComment>('DELETE',`${root(p)}/comments/${c.id}`,{expected_revision:c.revision}),
 getHandoff:(p:string,id:string)=>request<DesignHandoff>('GET',`${root(p)}/handoffs/${encodeURIComponent(id)}`),
 handoff:(p:string,id:string,revision:number,thread_ids:string[],links:DesignHandoff['context_refs'])=>mutation<DesignHandoff>('POST',doc(p,id)+'/handoffs',{revision,thread_ids,links}),
 link:(p:string,id:string,kind:string,target:string)=>mutation<DesignHandoff>('POST',`${root(p)}/handoffs/${id}/links`,{kind,id:target}),
 readAsset:(p:string,id:string)=>request<DesignAsset>('GET',`${root(p)}/assets/${encodeURIComponent(id)}`),
 asset:async(p:string,file:File)=>{
  const form=new FormData();form.set('file',file)
  const response=await fetch(`/api/v1${root(p)}/assets`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:form})
  const data=await response.json();if(!response.ok)throw new ApiError(data.message??data.error?.message??'Загрузка не выполнена',data.code??data.error?.code??'',response.status,data)
  return data as DesignAsset
 },
}
