window.WB = window.WB || {};

WB.pages = {
  simple: {
    name: '简单页',
    source: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>我的小店</title>
  <style>
    body { margin: 0; font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; background: #faf7f2; color: #333333; }
    section { position: relative; max-width: 720px; margin: 0 auto; padding: 48px 24px; }
    .title { font-size: 32px; margin: 0 0 12px; color: #2d2a26; }
    .subtitle { font-size: 18px; color: #7a7066; margin: 0 0 24px; line-height: 1.7; }
    .btn { display: inline-block; padding: 12px 28px; background: #e0795b; color: #ffffff; border-radius: 999px; text-decoration: none; }
    .photo { height: 180px; margin-top: 32px; border-radius: 16px; background: linear-gradient(135deg, #f6c9a8, #e0795b); }
  </style>
</head>
<body>
  <section class="hero">
    <h1 class="title">欢迎来到我的小店</h1>
    <p class="subtitle">每天清晨，从花市带回最新鲜的花。</p>
    <a class="btn" href="#">立即选购</a>
    <div class="photo"></div>
  </section>
  <section class="about">
    <h2 class="title">关于我们</h2>
    <p class="subtitle">一家开在巷子里的小花店，已经开了十年。</p>
  </section>
</body>
</html>`
  },

  complex: {
    name: '复杂页',
    source: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>星野花房</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif; background: #0f1222; color: #1f2430; overflow-x: hidden; }
    .bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; }
    .blob { position: absolute; width: 420px; height: 420px; border-radius: 50%; filter: blur(80px); opacity: 0.55; animation: drift 14s ease-in-out infinite alternate; }
    .blob-a { background: #6c5ce7; left: -80px; top: -60px; }
    .blob-b { background: #00cec9; right: -100px; top: 240px; animation-duration: 18s; }
    @keyframes drift { to { transform: translate(120px, 80px) scale(1.2); } }
    header { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 18px 40px; color: #ffffff; }
    .logo { font-size: 20px; font-weight: 700; margin: 0; }
    .nav { display: flex; gap: 28px; }
    .nav a { color: #c9cde8; text-decoration: none; font-size: 15px; }
    .hero { position: relative; max-width: 1100px; margin: 0 auto; padding: 72px 40px 56px; color: #ffffff; }
    .badge { display: inline-block; padding: 6px 14px; border-radius: 999px; background: rgba(255, 255, 255, 0.14); font-size: 13px; animation: float 3s ease-in-out infinite; }
    @keyframes float { 50% { transform: translateY(-8px); } }
    .hero-title { font-size: 52px; line-height: 1.15; margin: 18px 0 16px; }
    .fly-in { animation: fly-in 0.9s ease-out both; }
    @keyframes fly-in { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: none; } }
    .hero-text { font-size: 18px; color: #b8bdd9; max-width: 560px; margin: 0 0 28px; line-height: 1.7; }
    .btn { display: inline-block; padding: 12px 26px; border-radius: 12px; background: #6c5ce7; color: #ffffff; text-decoration: none; font-size: 15px; }
    .btn-ghost { background: transparent; border: 1px solid rgba(255, 255, 255, 0.35); margin-left: 12px; }
    .features { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; max-width: 1100px; margin: 0 auto; padding: 0 40px 56px; }
    .card { background: rgba(255, 255, 255, 0.92); border-radius: 18px; padding: 24px; }
    .card-title { font-size: 20px; margin: 0 0 8px; color: #1f2430; }
    .card-text { font-size: 14px; color: #5b6275; margin: 0; line-height: 1.7; }
    .marquee { overflow: hidden; white-space: nowrap; background: #6c5ce7; color: #ffffff; padding: 10px 0; }
    .marquee-inner { display: inline-block; animation: scroll 16s linear infinite; }
    @keyframes scroll { to { transform: translateX(-50%); } }
    .products { position: relative; max-width: 1100px; margin: 0 auto; padding: 48px 40px; color: #ffffff; }
    .section-title { font-size: 28px; margin: 0 0 20px; }
    #product-list { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .product { background: rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 16px; }
    .product-name { font-size: 16px; margin: 0 0 6px; }
    .product-price { margin: 0; color: #00cec9; }
    footer { position: relative; text-align: center; padding: 28px; color: #8a8fb0; font-size: 13px; }
    @media (max-width: 600px) {
      header { padding: 16px 20px; }
      .nav { display: none; }
      .hero { padding: 48px 20px 40px; }
      .hero-title { font-size: 34px; }
      .features { grid-template-columns: 1fr; padding: 0 20px 40px; }
      .products { padding: 40px 20px; }
      #product-list { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="bg">
    <div class="blob blob-a"></div>
    <div class="blob blob-b"></div>
  </div>
  <header>
    <p class="logo">星野花房</p>
    <nav class="nav">
      <a href="#">首页</a>
      <a href="#">花束</a>
      <a href="#">关于我们</a>
    </nav>
    <a class="btn" href="#">登录</a>
  </header>
  <section class="hero">
    <span class="badge">今日上新</span>
    <h1 class="hero-title fly-in">把春天，装进一束花里</h1>
    <p class="hero-text">每天清晨从花市带回最新鲜的花材，由花艺师手工搭配，两小时内送到你手上。</p>
    <a class="btn" href="#">立即选购</a>
    <a class="btn btn-ghost" href="#">了解更多</a>
  </section>
  <section class="features">
    <div class="card">
      <h3 class="card-title">当天鲜切</h3>
      <p class="card-text">花材当天到店、当天售出，不卖隔夜花。</p>
    </div>
    <div class="card">
      <h3 class="card-title">手工搭配</h3>
      <p class="card-text">每一束都由花艺师按季节和心意现场搭配。</p>
    </div>
    <div class="card">
      <h3 class="card-title">两小时送达</h3>
      <p class="card-text">市区下单后两小时内送到，可预约时间。</p>
    </div>
  </section>
  <div class="marquee">
    <div class="marquee-inner">春季限定 · 满 199 包邮 · 支持定时配送 · 春季限定 · 满 199 包邮 · 支持定时配送 ·</div>
  </div>
  <section class="products">
    <h2 class="section-title">本周热卖</h2>
    <div id="product-list"></div>
  </section>
  <footer>
    <p>© 2026 星野花房 · 本页面仅为演示</p>
  </footer>
  <script>
    var products = [
      { name: '白玫瑰花束', price: 199 },
      { name: '向日葵小捧花', price: 129 },
      { name: '郁金香礼盒', price: 259 },
      { name: '满天星花瓶', price: 89 }
    ];
    var list = document.getElementById('product-list');
    products.forEach(function (p) {
      list.innerHTML += '<div class="product"><p class="product-name">' + p.name + '</p><p class="product-price">¥' + p.price + '</p></div>';
    });
  </script>
</body>
</html>`
  }
};
