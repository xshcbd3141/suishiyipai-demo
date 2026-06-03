# DeepSeek 食物识别 Demo — 随食一拍

## 快速使用

1. 打开 demo/index.html (直接在浏览器打开就行)
2. 输入你的 DeepSeek API Key
3. 拍照或上传食物图片
4. AI自动识别食物并显示营养信息
5. 首次使用会提示: 去 https://platform.deepseek.com 注册获取免费API Key

## 技术说明

- 纯HTML+CSS+JS, 不需要Node.js, 不需要后端
- 直接调用DeepSeek API (兼容OpenAI格式)
- 图片用Canvas转base64后发送
- 支持拍照(手机)/选图(电脑)
