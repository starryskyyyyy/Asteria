const SUGGESTIONS = [
  { icon: '◎', title: '理解项目', hint: '梳理代码结构与入口', prompt: '先阅读项目结构，再告诉我关键模块和运行方式。' },
  { icon: '✎', title: '编写代码', hint: '描述要实现的功能', prompt: '请检查当前项目并实现：' },
  { icon: '⌕', title: '检查问题', hint: '审查并提出可执行建议', prompt: '请检查这个项目中最值得优先修复的问题，并解释理由。' },
];

export function Welcome({ onPick }: { onPick(prompt: string): void }) {
  return (
    <div className="welcome">
      <div className="welcome-mark" aria-hidden="true">✳</div>
      <h1>你好，今天想做什么？</h1>
      <p>选择 CLI 和模型，开始一段本机项目对话。主模型也可以通过真实工具委派其他模型。</p>
      <div className="welcome-cards">
        {SUGGESTIONS.map((item, index) => (
          <button key={item.title} type="button" style={{ animationDelay: `${index * 70}ms` }} onClick={() => onPick(item.prompt)}>
            <span aria-hidden="true">{item.icon}</span>
            <b>{item.title}</b>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
