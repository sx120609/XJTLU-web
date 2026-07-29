<template>
  <div class="material-publish-page">
    <header class="page-head">
      <div>
        <span>KAOPU CREATOR STUDIO</span>
        <h1>{{ editingId ? "编辑付费学习资料" : "发布付费学习资料" }}</h1>
        <p>设置合理价格并完整说明课程、内容范围与资料来源；提交后由平台人工审核。</p>
      </div>
      <el-button @click="router.push({ name: 'market-learning-materials' })">返回资料专区</el-button>
    </header>

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="publish-form cpu-card" v-loading="loading">
      <aside class="publish-readiness" aria-live="polite">
        <div><span>资料完整度</span><strong>{{ qualityScore }}%</strong></div>
        <small>{{ qualityHints.length ? `建议补充：${qualityHints.join('、')}` : '资料信息完整，可以提交' }}</small>
        <em>{{ draftSavedAt ? `已自动保存 ${new Date(draftSavedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}` : '文字与封面会自动保存在本机' }}</em>
      </aside>
      <section>
        <div class="section-title"><div><span>01</span><h2>资料基本信息</h2></div><small>标题和介绍会直接展示给同学</small></div>
        <el-form-item label="资料标题" prop="title" required>
          <el-input v-model="form.title" maxlength="120" show-word-limit placeholder="例如：CPT111 数据结构期末复习笔记" />
        </el-form-item>
        <el-form-item label="资料介绍" prop="description" required>
          <el-input v-model="form.description" type="textarea" :rows="7" maxlength="20000" show-word-limit placeholder="介绍资料内容、覆盖章节、适用对象以及不包含的内容。" />
        </el-form-item>
        <div class="two-cols price-fields">
          <el-form-item label="售价（元）" prop="price" required>
            <el-input-number v-model="form.price" :min="minPrice" :max="maxPrice" :precision="2" :step="1" controls-position="right" />
          </el-form-item>
          <el-form-item label="参考原价（选填）">
            <el-input-number v-model="form.originalPrice" :min="form.price" :max="maxPrice" :precision="2" :step="1" controls-position="right" />
          </el-form-item>
        </div>
        <el-alert type="info" :closable="false" show-icon title="买家直接向你的收款码付款，平台服务费为 0；请勿在介绍中留下站外联系方式。" />
      </section>

      <section>
        <div class="section-title"><div><span>02</span><h2>课程与适用范围</h2></div><small>带 * 的三项是正式发布必填项</small></div>
        <div class="three-cols">
          <el-form-item label="课程代码" prop="profile.courseCode" required>
            <el-input v-model="form.profile.courseCode" maxlength="32" placeholder="例如 CPT111" @blur="normalizeCode" />
          </el-form-item>
          <el-form-item label="适用学期" prop="profile.applicableSemester" required>
            <el-select v-model="form.profile.applicableSemester" placeholder="只能选择一个学期">
              <el-option v-for="item in meta.semesters" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="资料类型" prop="profile.typeId" required>
            <div class="type-picker">
              <el-select v-model="form.profile.typeId" filterable placeholder="选择资料类型">
                <el-option v-for="item in meta.types" :key="item.id" :value="item.id" :label="item.name">
                  <span>{{ item.name }}</span><el-tag v-if="item.status==='pending'" size="small" type="warning">我的待审核类型</el-tag>
                </el-option>
              </el-select>
              <el-button @click="customTypeOpen=true">创建类型</el-button>
            </div>
          </el-form-item>
        </div>
        <div class="two-cols">
          <el-form-item label="学院（选填）"><el-input v-model="form.profile.college" maxlength="120" placeholder="例如 School of Advanced Technology" /></el-form-item>
          <el-form-item label="专业（选填）"><el-input v-model="form.profile.major" maxlength="120" placeholder="例如 Information and Computing Science" /></el-form-item>
        </div>
      </section>

      <section>
        <div class="section-title"><div><span>03</span><h2>资料属性</h2></div><small>选填信息越完整，搜索匹配越准确</small></div>
        <div class="three-cols">
          <el-form-item label="文件格式（可多选）">
            <el-select v-model="form.profile.fileFormats" multiple collapse-tags placeholder="PDF、PPTX 等">
              <el-option v-for="item in meta.formats" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="总页数"><el-input-number v-model="form.profile.pageCount" :min="1" :max="100000" controls-position="right" placeholder="选填" /></el-form-item>
          <el-form-item label="版本"><el-input v-model="form.profile.versionLabel" maxlength="80" placeholder="例如 2026版 / v1.2" /></el-form-item>
        </div>
        <div class="three-cols">
          <el-form-item label="语言">
            <el-select v-model="form.profile.language" clearable placeholder="选填"><el-option v-for="item in meta.languages" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          </el-form-item>
          <el-form-item label="原创或授权类型" prop="profile.originalityKind" required>
            <el-select v-model="form.profile.originalityKind" placeholder="请选择"><el-option v-for="item in meta.originalityOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select>
          </el-form-item>
          <el-form-item label="原创 / 授权说明" prop="profile.originalityStatement" required><el-input v-model="form.profile.originalityStatement" maxlength="500" placeholder="说明本人创作过程、公开资料来源或授权情况" /></el-form-item>
        </div>
      </section>

      <section>
        <div class="section-title"><div><span>04</span><h2>封面与预览</h2></div><small>封面选填，最多9张</small></div>
        <div class="image-grid">
          <div v-for="(url,index) in form.images" :key="url" class="image-cell">
            <img :src="url" :alt="`资料预览 ${index + 1}`" /><span v-if="index===0">封面</span>
            <div class="image-actions"><button type="button" :disabled="index===0" aria-label="向前移动" @click="moveImage(index,index-1)">←</button><button type="button" :disabled="index===form.images.length-1" aria-label="向后移动" @click="moveImage(index,index+1)">→</button><button type="button" aria-label="删除图片" @click="form.images.splice(index,1)">×</button></div>
          </div>
          <label v-if="form.images.length<9" class="upload-cell" :class="{disabled:uploading}">
            <input type="file" accept="image/*" multiple :disabled="uploading" @change="uploadImages" />
            <el-icon :class="{'is-loading':uploading}"><Loading v-if="uploading" /><Plus v-else /></el-icon>
            <b>{{ uploading ? `上传中 ${uploadProgress}%` : "添加图片" }}</b>
          </label>
        </div>
      </section>

      <section>
        <div class="section-title"><div><span>05</span><h2>资料文件与版本</h2></div><small>文件由平台安全存储，卖家确认到账后才开放下载</small></div>
        <div v-if="existingFiles.length" class="existing-files"><article v-for="file in existingFiles" :key="file.id"><b>{{ file.originalName }}</b><span>{{ file.format }} · {{ formatBytes(file.fileSize) }}</span></article></div>
        <el-alert type="info" :closable="false" show-icon title="V1 付费资料至少包含一份 PDF，并为其中一份设置 1～10 页真实试读；试读页直接从交付文件抽取。" style="margin-bottom:12px" />
        <div v-if="pendingFiles.length" class="pending-files"><article v-for="(file,index) in pendingFiles" :key="`${file.name}-${file.size}`"><div><b>{{ file.name }}</b><span>{{ formatBytes(file.size) }}</span><div v-if="isPdf(file)" class="preview-range"><label>试读页</label><el-input-number v-model="previewRanges[fileKey(file)].start" :min="1" :max="9999" size="small" controls-position="right" /><i>至</i><el-input-number v-model="previewRanges[fileKey(file)].end" :min="previewRanges[fileKey(file)].start" :max="9999" size="small" controls-position="right" /></div></div><button type="button" @click="removePendingFile(index)">×</button></article></div>
        <label v-if="pendingFiles.length<10" class="file-picker">
          <input type="file" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip,.txt,.md,.jpg,.jpeg,.png,.webp" @change="selectMaterialFiles" />
          <el-icon><Plus /></el-icon><div><b>{{ existingFiles.length ? "上传新版本文件" : "选择资料文件" }}</b><span>最多10个文件，单个不超过100MB</span></div>
        </label>
        <div class="two-cols version-fields"><el-form-item label="文件版本标签"><el-input v-model="versionDraft.label" maxlength="80" placeholder="例如 2026版 / v1.2" /></el-form-item><el-form-item label="版本更新说明"><el-input v-model="versionDraft.releaseNotes" maxlength="1000" placeholder="首次发布可简要说明内容范围" /></el-form-item></div>
        <el-progress v-if="fileUploading" :percentage="fileUploadProgress" :stroke-width="8" />
      </section>

      <section>
        <div class="section-title"><div><span>06</span><h2>审核与权利确认</h2></div><small>付费不改变版权边界，内容必须原创、已获授权或依法可使用</small></div>
        <el-alert type="success" :closable="false" show-icon title="正式提交后进入人工审核；审核通过才公开上架，后续重大修改需要重新审核。" />
        <el-form-item prop="profile.rightsConfirmed">
          <el-checkbox v-model="form.profile.rightsConfirmed" size="large">我确认拥有发布和销售该内容的合法权利，并接受平台内容及交易规则</el-checkbox>
        </el-form-item>
        <el-alert type="warning" :closable="false" show-icon title="禁止上传作业答案、代写内容、考试原题、教师课件、教材 PDF、课堂录音或其他未获授权的资料。" />
      </section>

      <footer class="form-actions">
        <el-button :loading="submitting" @click="submit(true)">保存草稿</el-button>
        <el-button type="primary" :loading="submitting" @click="submit(false)">{{ editingId ? "保存并提交审核" : "提交人工审核" }}</el-button>
      </footer>
    </el-form>

    <el-dialog v-model="customTypeOpen" title="创建资料类型" width="430px">
      <p class="dialog-note">自定义类型可立即用于你的资料，审核通过后才会进入全站公共筛选。</p>
      <el-input v-model="customTypeName" maxlength="20" show-word-limit placeholder="例如：课程案例集" @keyup.enter="createType" />
      <template #footer><el-button @click="customTypeOpen=false">取消</el-button><el-button type="primary" :loading="creatingType" @click="createType">创建并选中</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Loading, Plus } from "@element-plus/icons-vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { learningMaterialsApi, type LearningMaterialItemInput, type LearningMaterialMeta } from "@/api/learningMaterials";
import { uploadApi } from "@/api/topic";
import { useAuthStore } from "@/stores/auth";
import { clearPublishDraft, moveArrayEntry, readPublishDraft, savePublishDraft } from "@/utils/publishDraft";
import { optimizePublishImage } from "@/utils/publishImage";

const route=useRoute();const router=useRouter();const auth=useAuthStore();const editingId=Number(route.params.id||0);const formRef=ref<FormInstance>();
const loading=ref(false);const submitting=ref(false);const uploading=ref(false);const uploadProgress=ref(0);const customTypeOpen=ref(false);const customTypeName=ref("");const creatingType=ref(false);const pendingFiles=ref<File[]>([]);const previewRanges=reactive<Record<string,{start:number;end:number}>>({});const existingFiles=ref<Array<{id:number;originalName:string;format:string;fileSize:number;previewEnabled?:boolean}>>([]);const fileUploading=ref(false);const fileUploadProgress=ref(0);const versionDraft=reactive({label:"",releaseNotes:""});
const meta=reactive<LearningMaterialMeta>({category:{id:0,slug:"digital_goods",name:"电子资料",icon:"📁",description:"",fulfillmentType:"digital",imageRequired:false,enabled:true,sort:30,itemCount:0},semesters:[],formats:[],languages:[],originalityOptions:[],supportCategories:[],types:[],legacyIncompleteCount:0});
const form=reactive({title:"",description:"",price:9.9,originalPrice:undefined as number|undefined,images:[] as string[],profile:{courseCode:"",college:"",major:"",typeId:null as number|null,applicableSemester:"",fileFormats:[] as string[],pageCount:undefined as number|undefined,versionLabel:"",language:"",originalityKind:"",originalityStatement:"",rightsConfirmed:false}});
const hasCollectionMethod=ref(false);
const minPrice=computed(()=>Number(meta.commerce?.minPrice||1));
const maxPrice=computed(()=>Number(meta.commerce?.maxPrice||1000));
const draftReady=ref(false);const draftSavedAt=ref(0);let draftTimer=0;
const qualityHints=computed(()=>{const hints:string[]=[];if(form.title.trim().length<8)hints.push("更具体的标题");if(form.description.trim().length<50)hints.push("内容范围");if(!form.profile.courseCode)hints.push("课程代码");if(!form.profile.applicableSemester)hints.push("适用学期");if(!form.profile.typeId)hints.push("资料类型");if(!form.profile.originalityStatement.trim())hints.push("原创说明");if(!form.images.length)hints.push("封面预览");if(!pendingFiles.value.length&&!existingFiles.value.length)hints.push("资料文件");if(form.price<minPrice.value||form.price>maxPrice.value)hints.push("有效售价");return hints});
const qualityScore=computed(()=>Math.round(((9-Math.min(9,qualityHints.value.length))/9)*100));
watch(form,()=>{if(!draftReady.value||editingId)return;window.clearTimeout(draftTimer);draftTimer=window.setTimeout(()=>{draftSavedAt.value=savePublishDraft("learning-material",{...JSON.parse(JSON.stringify(form)),versionDraft:{...versionDraft}},auth.user?.id)},500)},{deep:true});
watch(versionDraft,()=>{if(!draftReady.value||editingId)return;window.clearTimeout(draftTimer);draftTimer=window.setTimeout(()=>{draftSavedAt.value=savePublishDraft("learning-material",{...JSON.parse(JSON.stringify(form)),versionDraft:{...versionDraft}},auth.user?.id)},500)},{deep:true});
onBeforeUnmount(()=>window.clearTimeout(draftTimer));
const rules:FormRules={title:[{required:true,message:"请填写资料标题",trigger:"blur"},{min:2,max:120,message:"标题需要为2～120个字符",trigger:"blur"}],description:[{required:true,message:"请填写资料介绍",trigger:"blur"}],price:[{validator:(_rule,value,callback)=>Number(value)>=minPrice.value&&Number(value)<=maxPrice.value?callback():callback(new Error(`售价需在 ${minPrice.value}～${maxPrice.value} 元之间`)),trigger:"change"}],"profile.courseCode":[{required:true,message:"请填写课程代码",trigger:"blur"},{pattern:/^[A-Za-z0-9][A-Za-z0-9._/\s-]{1,31}$/,message:"课程代码格式不正确",trigger:"blur"}],"profile.applicableSemester":[{required:true,message:"请选择适用学期",trigger:"change"}],"profile.typeId":[{required:true,message:"请选择资料类型",trigger:"change"}],"profile.originalityKind":[{required:true,message:"请选择原创或授权类型",trigger:"change"}],"profile.originalityStatement":[{required:true,message:"请填写原创或授权情况说明",trigger:"blur"}],"profile.rightsConfirmed":[{validator:(_rule,_value,callback)=>form.profile.rightsConfirmed?callback():callback(new Error("请确认拥有内容发布和销售权利")),trigger:"change"}]};

onMounted(load);
async function load(){
  loading.value=true;
  try{
    const [nextMeta,creator]=await Promise.all([
      learningMaterialsApi.meta({suppressErrorMessage:true}),
      learningMaterialsApi.creatorContext({suppressErrorMessage:true}),
    ]);
    Object.assign(meta,nextMeta);
    if(!meta.commerce?.paidEnabled){
      ElMessage.warning("付费学习资料当前尚未开放");
      return router.replace({name:"market-learning-materials"});
    }
    if(creator.profile?.status!=="active"){
      ElMessage.warning("请先完成创作者认证");
      return router.replace({name:"market-learning-creator"});
    }
    hasCollectionMethod.value=creator.profile.collectionMethods.some(row=>row.status==="active");
    if(editingId){
      const item=await learningMaterialsApi.item(editingId,{suppressErrorMessage:true});
      if(!item.mine){
        ElMessage.error("无权编辑该资料");
        return router.replace({name:"market-learning-materials"});
      }
      Object.assign(form,{title:item.title,description:item.description,price:Number(item.price),originalPrice:item.originalPrice?Number(item.originalPrice):undefined,images:item.images.map(row=>row.url)});
      if(item.material){
        Object.assign(form.profile,{courseCode:item.material.courseCode,college:item.material.college,major:item.material.major,typeId:item.material.typeId||null,applicableSemester:item.material.applicableSemester,fileFormats:[...item.material.fileFormats],pageCount:item.material.pageCount||undefined,versionLabel:item.material.versionLabel,language:item.material.language,originalityKind:item.material.originalityKind,originalityStatement:item.material.originalityStatement,rightsConfirmed:item.material.rightsConfirmed});
        const editableVersion=item.material.draftVersion||item.material.activeVersion;
        existingFiles.value=(editableVersion?.files||[]).map(file=>({id:file.id,originalName:file.originalName,format:file.format,fileSize:file.fileSize,previewEnabled:file.previewEnabled}));
        versionDraft.label=editableVersion?.label||item.material.versionLabel||"";
      }
    }else{
      const localDraft=readPublishDraft<Record<string,unknown>>("learning-material",auth.user?.id);
      if(localDraft){
        const {versionDraft:localVersion,...localForm}=localDraft.value as any;
        Object.assign(form,localForm);
        form.images=Array.isArray(localForm.images)?localForm.images.map(String).slice(0,9):[];
        if(localVersion&&typeof localVersion==="object")Object.assign(versionDraft,localVersion);
        draftSavedAt.value=localDraft.savedAt;
        ElMessage.info("已恢复本机未提交的资料内容");
      }
      if(form.price<minPrice.value||form.price>maxPrice.value)form.price=Math.max(minPrice.value,9.9);
    }
  }finally{
    draftReady.value=true;
    loading.value=false;
  }
}
function normalizeCode(){form.profile.courseCode=form.profile.courseCode.trim().toUpperCase().replace(/\s+/g,"")}
async function uploadImages(event:Event){const input=event.target as HTMLInputElement;const files=Array.from(input.files||[]).slice(0,9-form.images.length);if(!files.length)return;uploading.value=true;try{for(let index=0;index<files.length;index++){const file=await optimizePublishImage(files[index]);const result=await uploadApi.media(file,file.name,{onProgress:(state)=>{uploadProgress.value=Math.round(((index+state.percent/100)/files.length)*100)}});form.images.push(result.url)}}catch(error){ElMessage.error(error instanceof Error?error.message:"图片上传失败")}finally{uploading.value=false;uploadProgress.value=0;input.value=""}}
function moveImage(from:number,to:number){moveArrayEntry(form.images,from,to)}
async function createType(){const name=customTypeName.value.trim();if(name.length<2)return ElMessage.warning("类型名称至少需要2个字符");creatingType.value=true;try{const created=await learningMaterialsApi.createType(name);if(!meta.types.some(row=>row.id===created.id))meta.types.push(created);form.profile.typeId=created.id;customTypeOpen.value=false;customTypeName.value="";ElMessage.success(created.status==="pending"?"已创建，审核前仅你可以使用":"已选用现有资料类型")}finally{creatingType.value=false}}
function fileKey(file:File){return `${file.name}:${file.size}:${file.lastModified}`}function isPdf(file:File){return /\.pdf$/i.test(file.name)}function selectMaterialFiles(event:Event){const input=event.target as HTMLInputElement;const allow=/\.(pdf|docx?|pptx?|xlsx?|zip|txt|md|jpe?g|png|webp)$/i;for(const file of Array.from(input.files||[])){if(pendingFiles.value.length>=10)break;if(file.size>100*1024*1024){ElMessage.warning(`${file.name} 超过100MB`);continue}if(!allow.test(file.name)){ElMessage.warning(`${file.name} 的格式暂不支持`);continue}if(!pendingFiles.value.some(row=>row.name===file.name&&row.size===file.size)){pendingFiles.value.push(file);if(isPdf(file))previewRanges[fileKey(file)]={start:1,end:1}}}input.value=""}function removePendingFile(index:number){const [file]=pendingFiles.value.splice(index,1);if(file)delete previewRanges[fileKey(file)]}
function formatBytes(value:number){if(value<1024*1024)return `${Math.max(1,Math.round(value/1024))} KB`;return `${(value/1024/1024).toFixed(1)} MB`}
async function uploadPendingVersion(itemId:number){if(!pendingFiles.value.length)return null;fileUploading.value=true;try{const version=await learningMaterialsApi.uploadVersion(itemId,pendingFiles.value,{label:versionDraft.label||form.profile.versionLabel,releaseNotes:versionDraft.releaseNotes,previewRanges:pendingFiles.value.map(file=>isPdf(file)?previewRanges[fileKey(file)]:null)},{timeout:10*60*1000,onUploadProgress:(event)=>{const total=Number(event.total||0);fileUploadProgress.value=total?Math.round(Number(event.loaded||0)/total*100):0}});existingFiles.value=version.files.map(file=>({id:file.id,originalName:file.originalName,format:file.format,fileSize:file.fileSize,previewEnabled:file.previewEnabled}));pendingFiles.value=[];return version}finally{fileUploading.value=false;fileUploadProgress.value=0}}
async function submit(draft:boolean){
  if(submitting.value)return;
  normalizeCode();
  if(form.price<minPrice.value||form.price>maxPrice.value)return ElMessage.warning(`售价需在 ${minPrice.value}～${maxPrice.value} 元之间`);
  if(form.originalPrice!==undefined&&form.originalPrice<form.price)return ElMessage.warning("参考原价不能低于当前售价");
  if(!draft){
    try{await formRef.value?.validate()}catch{return}
    if(!hasCollectionMethod.value)return ElMessage.warning("请先在创作者中心配置有效收款码");
    if(!editingId&&!pendingFiles.value.length)return ElMessage.warning("提交审核前请上传至少一个资料文件");
    if(editingId&&!existingFiles.value.length&&!pendingFiles.value.length)return ElMessage.warning("提交审核前请上传至少一个资料文件");
    const pendingPdf=pendingFiles.value.filter(isPdf);const hasPreview=pendingPdf.some(file=>{const range=previewRanges[fileKey(file)];return range&&range.start>=1&&range.end>=range.start&&range.end-range.start<10})||existingFiles.value.some(file=>file.format==="PDF"&&file.previewEnabled);
    if(!pendingPdf.length&&!existingFiles.value.some(file=>file.format==="PDF"))return ElMessage.warning("V1 付费资料至少需要一份 PDF");
    if(!hasPreview)return ElMessage.warning("请为至少一份 PDF 设置 1～10 页真实试读");
  }else if(!form.title.trim()||!form.description.trim()){
    return ElMessage.warning("草稿也需要填写标题和资料介绍");
  }
  submitting.value=true;
  try{
    const payload:LearningMaterialItemInput={title:form.title.trim(),description:form.description.trim(),price:form.price,originalPrice:form.originalPrice??null,images:[...form.images],profile:{...form.profile,pageCount:form.profile.pageCount??null,applicableSemester:form.profile.applicableSemester||null},draft:true};
    const item=editingId?await learningMaterialsApi.updateItem(editingId,payload):await learningMaterialsApi.createItem(payload);
    const uploadedVersion=await uploadPendingVersion(item.id);
    if(!draft){
      const versionId=uploadedVersion?.id||item.material?.draftVersion?.id||item.material?.activeVersion?.id;
      if(!versionId)return ElMessage.warning("没有可提交审核的资料版本");
      await learningMaterialsApi.submitVersionReview(item.id,versionId);
      clearPublishDraft("learning-material",auth.user?.id);
      ElMessage.success("资料已提交人工审核，通过后会公开上架");
      await router.replace({name:"market-learning-material-item",params:{id:item.id},query:{submitted:"1"}});
    }else{
      clearPublishDraft("learning-material",auth.user?.id);
      ElMessage.success("草稿和文件版本已保存");
      await router.replace({name:"market-learning-materials-edit",params:{id:item.id}});
    }
  }finally{submitting.value=false}
}
</script>

<style scoped>
.material-publish-page{max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:18px}.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}.page-head span{color:#a21caf;font-size:10px;font-weight:800;letter-spacing:.17em}.page-head h1{margin:6px 0;font-size:30px}.page-head p{margin:0;color:var(--cpu-text-secondary);font-size:13px}.publish-form{padding:28px}.publish-form section+section{margin-top:31px;padding-top:25px;border-top:1px solid var(--cpu-border-soft)}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}.section-title>div{display:flex;align-items:center;gap:10px}.section-title span{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;color:#fff;background:linear-gradient(135deg,#be185d,#7c3aed);font-size:10px;font-weight:800}.section-title h2{margin:0;font-size:18px}.section-title small{color:var(--cpu-text-secondary)}.two-cols,.three-cols{display:grid;gap:18px}.two-cols{grid-template-columns:repeat(2,minmax(0,1fr))}.three-cols{grid-template-columns:repeat(3,minmax(0,1fr))}.type-picker{display:grid;grid-template-columns:1fr auto;gap:8px;width:100%}.type-picker .el-select,.three-cols .el-select,.two-cols .el-select{width:100%}.type-picker :deep(.el-select-dropdown__item){display:flex;align-items:center;justify-content:space-between}.image-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.image-cell,.upload-cell{position:relative;aspect-ratio:1;overflow:hidden;border-radius:12px;background:var(--cpu-surface-soft)}.image-cell img{width:100%;height:100%;object-fit:cover}.image-cell span{position:absolute;left:7px;bottom:7px;padding:2px 6px;border-radius:5px;color:#fff;background:#a21caf;font-size:9px}.image-cell button{position:absolute;right:6px;top:6px;width:25px;height:25px;border:0;border-radius:50%;color:#fff;background:rgba(15,23,42,.68);cursor:pointer}.upload-cell{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;border:1px dashed var(--cpu-border);color:var(--cpu-text-secondary);cursor:pointer}.upload-cell input{display:none}.upload-cell .el-icon{font-size:24px}.upload-cell b{font-size:11px}.price-fields :deep(.el-input-number){width:100%}.form-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:27px;padding-top:21px;border-top:1px solid var(--cpu-border-soft)}.dialog-note{margin-top:0;color:var(--cpu-text-secondary);font-size:12px;line-height:1.7}@media(max-width:800px){.page-head{align-items:flex-start;flex-direction:column}.publish-form{padding:18px}.three-cols,.two-cols{grid-template-columns:1fr}.image-grid{grid-template-columns:repeat(3,1fr)}.section-title{align-items:flex-start;flex-direction:column;gap:7px}.form-actions .el-button{flex:1}}@media(max-width:480px){.image-grid{grid-template-columns:repeat(2,1fr)}.type-picker{grid-template-columns:1fr}}
.existing-files,.pending-files{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}.existing-files article,.pending-files article{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px;border:1px solid var(--cpu-border-soft);border-radius:10px}.existing-files article{flex-direction:column;align-items:flex-start}.existing-files b,.pending-files b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;font-size:11px}.existing-files span,.pending-files span{color:var(--cpu-text-secondary);font-size:9px}.pending-files article>div{display:flex;min-width:0;flex-direction:column}.pending-files button{border:0;color:#ef4444;background:transparent;font-size:18px;cursor:pointer}.file-picker{display:flex;align-items:center;gap:12px;padding:16px;border:1px dashed #c084fc;border-radius:11px;color:#701a75;background:#fdf4ff;cursor:pointer}.file-picker input{display:none}.file-picker .el-icon{font-size:25px}.file-picker>div{display:flex;flex-direction:column}.file-picker span{color:#9d5d77;font-size:9px}.version-fields{margin-top:14px}.el-progress{margin-top:12px}@media(max-width:650px){.existing-files,.pending-files{grid-template-columns:1fr}}
.publish-readiness{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:5px 14px;margin-bottom:22px;padding:14px 16px;border:1px solid rgba(162,28,175,.22);border-radius:13px;background:color-mix(in srgb,#fdf4ff 70%,var(--cpu-card))}.publish-readiness>div{display:flex;align-items:baseline;gap:8px}.publish-readiness span,.publish-readiness small,.publish-readiness em{color:var(--cpu-text-secondary);font-size:11px}.publish-readiness strong{color:#a21caf;font-size:19px}.publish-readiness em{font-size:10px;font-style:normal;white-space:nowrap}.image-actions{position:absolute;left:6px;right:6px;bottom:6px;display:flex;justify-content:flex-end;gap:4px}.image-cell>.image-actions button{position:static;display:grid;place-items:center;width:25px;height:25px;padding:0;border:0;border-radius:7px;color:#fff;background:rgba(15,23,42,.72);cursor:pointer}.image-cell>.image-actions button:disabled{opacity:.35;cursor:not-allowed}.image-cell>span{top:7px;bottom:auto}@media(max-width:800px){.publish-readiness{grid-template-columns:1fr}.form-actions{position:sticky;z-index:5;bottom:calc(66px + env(safe-area-inset-bottom));margin:22px -18px -18px;padding:12px 18px;background:var(--cpu-card);box-shadow:0 -8px 20px rgba(15,23,42,.06)}}
.preview-range{display:grid!important;grid-template-columns:auto 105px auto 105px;align-items:center;gap:7px;margin-top:7px}.preview-range label,.preview-range i{color:var(--cpu-text-secondary);font-size:10px;font-style:normal}.pending-files article:has(.preview-range){align-items:flex-start}@media(max-width:650px){.preview-range{grid-template-columns:auto 1fr auto 1fr}}
</style>
