import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { DESIGN_PREVIEW_SCRIPT, DESIGN_PREVIEW_SCRIPT_HASH, appendDesignPatch, applyDesignPatch, componentProperty, initialDesign, previewSelection, renderDesignPreview, walkNodes } from './designModel.ts'
let num=0
const fixture=()=>initialDesign(()=>`00000000-0000-4000-8000-${String(++num).padStart(12,'0')}`)
test('local property patch preserves stable ID and original model',()=>{
 const m=fixture(),node=m.screens[0].root.children[0],n=applyDesignPatch(m,[{op:'set_property',element_id:node.id,property:'text',value:'Правка',scope:'instance'}])
 assert.equal(n.screens[0].root.children[0].id,node.id);assert.equal(n.screens[0].root.children[0].props.text,'Правка');assert.equal(node.props.text,'Новый продукт')
})
test('instance override is explicit and shared component root unchanged',()=>{
 const m=fixture(),node=m.screens[0].root.children[1],n=applyDesignPatch(m,[{op:'set_property',element_id:node.id,property:'padding',value:24,scope:'instance'}])
 assert.deepEqual(n.overrides,[{instance_id:node.id,property:'padding',value:24}]);assert.equal(n.components[0].root.props.padding,12)
})
test('shared component edit keeps stable IDs and repeated scopes do not overwrite model',()=>{
 const m=fixture(),id=m.components[0].root.id,op=componentProperty(m,id,'text','Общее')
 const n=applyDesignPatch(m,[op]);assert.equal(n.components[0].root.id,id);assert.equal(n.components[0].root.props.text,'Общее');assert.equal(m.components[0].root.props.text,'Продолжить')
})
test('token edits affect references, not unrelated override',()=>{
 const m=fixture(),node=m.screens[0].root.children[1],token=m.tokens[0]
 const n=applyDesignPatch(m,[{op:'set_property',element_id:node.id,property:'color',value:'#123456',scope:'instance'},{op:'set_token',token_id:token.id,value:{hex:'#abcdef'}}])
 assert.equal(n.overrides[0].value,'#123456');assert.equal(n.tokens[0].value.hex,'#abcdef')
})
test('structural ops are ordered and failed missing parent is not silently dropped',()=>{
 const m=fixture(),root=m.screens[0].root,newNode={id:'new',type:'text' as const,props:{text:'new'},children:[]}
 const n=applyDesignPatch(m,[{op:'add_node',parent_id:root.id,node:newNode,index:1},{op:'remove_node',element_id:root.children[0].id}]);assert.equal(n.screens[0].root.children[0].id,'new')
 assert.throws(()=>applyDesignPatch(m,[{op:'add_node',parent_id:'missing',node:newNode,index:0}]))
})
test('renderer escapes HTML and excludes raw CSS/JS/imported properties',()=>{
 const m=fixture(),root=m.screens[0].root
 root.children[0].props.text='<img src=x onerror=alert(1)><script>alert(1)</script>'
 root.props.background='url(javascript:alert(1))';root.props.raw_html='<script>evil()</script>';root.props.font_family='x; background:url(https://evil.test)'
 const html=renderDesignPreview(m,root,'doc',1,'nonce','')
 assert.match(html,/&lt;img/);assert.ok(!html.includes('<img src=x'));assert.ok(!html.includes('url(javascript:'));assert.ok(!html.includes('background:url'));assert.ok(!html.includes('evil()'))
 assert.ok(html.includes(`script-src '${DESIGN_PREVIEW_SCRIPT_HASH}'`));assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/)
 assert.equal((html.match(/<script>/g)??[]).length,1)
})
test('preview selection validates nonce/document/revision/known element',()=>{
 const m=fixture(),id=walkNodes(m)[0].id,good={type:'select',channel_nonce:'n',document_id:'d',revision:4,element_id:id}
 assert.equal(previewSelection(good,'n','d',4,m),id)
 for(const patch of [{type:'save'},{channel_nonce:'x'},{document_id:'other'},{revision:5},{element_id:'foreign'}])assert.equal(previewSelection({...good,...patch},'n','d',4,m),null)
})
test('cyclic component instances do not recurse indefinitely',()=>{
 const m=fixture();m.components[0].root={id:'root',type:'instance',props:{},children:[],component_id:m.components[0].id}
 assert.match(renderDesignPreview(m,m.screens[0].root,'d',1,'n',''),/Компонент недоступен/)
})

test('typing coalesces adjacent patches but preserves structural ordering',()=>{
 const op={op:'set_property' as const,element_id:'a',property:'text',value:'a',scope:'instance' as const}
 const folded=appendDesignPatch([op],{...op,value:'ab'});assert.equal(folded.length,1);assert.equal(folded[0].value,'ab')
 const structural={op:'remove_node' as const,element_id:'b'};assert.equal(appendDesignPatch([op,structural],{...op,value:'abc'}).length,3)
})

test('preview script is byte-identical across documents and matches the reviewed response CSP hash',()=>{
 assert.equal(DESIGN_PREVIEW_SCRIPT_HASH,`sha256-${createHash('sha256').update(DESIGN_PREVIEW_SCRIPT).digest('base64')}`)
 const m=fixture(),first=renderDesignPreview(m,m.screens[0].root,'doc1',1,'channel1',''),second=renderDesignPreview(m,m.screens[0].root,'doc2',9,'channel2','')
 const code=(html:string)=>html.match(/<script>([\s\S]*?)<\/script>/)![1]
 assert.equal(code(first),DESIGN_PREVIEW_SCRIPT);assert.equal(code(second),DESIGN_PREVIEW_SCRIPT)
 assert.ok(first.includes('data-channel-nonce="channel1"'));assert.ok(second.includes('data-document-id="doc2"'))
 assert.ok(!code(first).includes('channel1'));assert.ok(!code(second).includes('doc2'))
})
