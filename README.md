# IBD Day · 自在如风

AI 驱动的 IBD Day 生活方式海报生成工具。

## 快速部署到 Netlify

需要部署到 Netlify（启用 Serverless Functions）才能调用 Liblib AI API。

### 方式一：GitHub 部署（推荐）

1. 创建 GitHub 仓库，将此文件夹内容推送上去
2. 访问 https://app.netlify.com
3. 点 **Add new site** → **Import an existing project**
4. 选择 **GitHub**，授权，选中此仓库
5. 点 **Deploy site**

### 方式二：Netlify CLI

```bash
npm install -g netlify-cli
netlify deploy --prod
```

## 文件说明

- `index.html` - 网站主页面（前端）
- `netlify/functions/proxy.js` - API 代理（处理图片上传 + AI 生成调用）
- `netlify.toml` - Netlify 构建配置

## 工作流程

1. 用户选择生活方式
2. 上传照片 → 浏览器传给 Netlify Function
3. Function 将图片上传到 Liblib OSS
4. Function 调用 Liblib ComfyUI 工作流 API
5. 轮询任务状态，获取生成的图片 URL
6. 用户下载/保存结果

## Liblib AI 工作流参数

- templateUuid: `4df2efa0f18d46dc9758803e478eb51c`
- workflowUuid: `577f90b34b2543e2a4837a0beb119404`
- 图片节点: LoadImage → `99.inputs.image`
