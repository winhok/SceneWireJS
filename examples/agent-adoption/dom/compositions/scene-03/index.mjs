let stage, card, cursor, progress;
const phase = 2;
const clamp = (v) => Math.max(0, Math.min(1, v));
export default {
  mount(root) {
    stage = document.createElement('div');
    stage.style.cssText =
      'position:absolute;inset:0;background:#101827;color:#f5f7fb;font-family:Arial,sans-serif;overflow:hidden';
    stage.innerHTML =
      '<div style="position:absolute;left:76px;top:49px;font-size:18px;letter-spacing:4px;color:#91a1b8">SCENEWIRE / FROM INTENT TO VIDEO</div><div style="position:absolute;left:76px;top:146px;color:#53d5b0;font-size:22px">03 / 03</div><div style="position:absolute;left:72px;top:190px;font-size:84px;font-weight:700;letter-spacing:-4px">Deliver</div><div style="position:absolute;left:76px;top:310px;font-size:29px;line-height:1.5;white-space:pre-line;color:#c4cfdf">Check the frames. Render.\nVerify the finished MP4.</div><div id="card" style="position:absolute;left:710px;top:164px;width:440px;height:310px;border:1px solid #42516a;border-radius:20px;background:#18263b"><div style="padding:28px;font-size:17px;letter-spacing:2px;color:#91a1b8">VIDEO.MP4 · READY TO DELIVER</div><div style="margin:5px 28px;height:146px;border-radius:10px;background:#244e50;display:flex;align-items:center;justify-content:center;font-size:58px;color:#53d5b0">\u25b6</div><div style="margin:22px 28px;font-size:21px">1280 \u00d7 720 \u00b7 30 fps \u00b7 12 s</div></div><div id="cursor" style="position:absolute;top:164px;width:3px;height:310px;background:#53d5b0"></div><div style="position:absolute;left:76px;right:76px;top:558px;height:2px;background:#34445b"></div><div style="position:absolute;left:76px;top:589px;color:#91a1b8;font-size:22px">01 &nbsp; Describe</div><div style="position:absolute;left:482px;top:589px;color:#91a1b8;font-size:22px">02 &nbsp; Compose</div><div style="position:absolute;left:888px;top:589px;color:#53d5b0;font-size:22px">03 &nbsp; Deliver</div><div id="progress" style="position:absolute;left:76px;top:551px;width:16px;height:16px;border-radius:50%;background:#53d5b0"></div><div style="position:absolute;right:76px;bottom:34px;font-size:15px;color:#91a1b8">INTENTIONALLY SILENT</div>';
    root.append(stage);
    card = stage.querySelector('#card');
    cursor = stage.querySelector('#cursor');
    progress = stage.querySelector('#progress');
  },
  seek(context) {
    const f = context.frame - phase * 120;
    const t = f / 30;
    const e = 1 - Math.pow(1 - clamp(t / 0.65), 3);
    card.style.transform = 'translateY(' + 24 * (1 - e) + 'px)';
    card.style.opacity = String(0.6 + 0.4 * e);
    cursor.style.left = 738 + 340 * clamp(t / 3.7) + 'px';
    cursor.style.opacity = phase === 1 ? '0.75' : '0';
    progress.style.transform =
      'translateX(' + clamp(context.frame / 330) * 1112 + 'px)';
  },
  dispose() {
    stage.remove();
  },
};
