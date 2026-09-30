---
name: centdeck-orchestrate
description: 按需协作、交接和问题处理
---

先读取 project_context，明确模式、助手能力、范围和预算。主助手默认可以独立完成任务，只有有必要且协作已授权时才 delegate。按真实依赖拆解页面任务；一层分派，禁止绕过调度器。共享修改单独处理。等待由运行层管理，不轮询消耗模型。需要用户决定时 request_input；未回答不能当作批准。依据真实提交与检查汇报。
