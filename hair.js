(function () {

  /* ===== 可调参数 ===== */
  const DROP_PROBABILITY = 0.2; // 概率
  const MOBILE_BREAKPOINT = 600;

  /* ===== 是否掉落 ===== */
  if (Math.random() > DROP_PROBABILITY) return;

  /* ===== 基础数据 ===== */
  const dpr = window.devicePixelRatio || 1;
  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;

  const length = isMobile ? 85 : 120;   // 短发长度
  const strokeWidth = 0.6 / dpr;
  const shadowWidth = 1.2 / dpr;

  /* ===== 随机参数 ===== */
  const randomTop = Math.random() * 80 + 5;   // 5% - 85%
  const randomLeft = Math.random() * 80 + 5;
  const randomRotate = (Math.random() - 0.5) * 30;  // -15° ~ 15°
  const randomCurve = (Math.random() - 0.5) * 0.2;  // 控制弯曲幅度

  /* ===== 创建容器 ===== */
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = randomTop + "%";
  container.style.left = randomLeft + "%";
  container.style.transform = `rotate(${randomRotate}deg)`;
  container.style.pointerEvents = "none";
  container.style.zIndex = "2147483647";

  /* ===== 创建 SVG ===== */
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");

  svg.setAttribute("width", length);
  svg.setAttribute("height", length * 0.5);
  svg.setAttribute("viewBox", `0 0 ${length} ${length * 0.5}`);

  /* ===== 轻微随机弯曲 ===== */
  const startY = length * 0.3;
  const controlX = length * 0.5;
  const controlY = length * (0.1 + randomCurve);
  const endY = length * 0.3;

  const pathData = `
    M10 ${startY}
    Q ${controlX} ${controlY}
      ${length - 10} ${endY}
  `;

  /* ===== 阴影 ===== */
  const shadow = document.createElementNS(svgNS, "path");
  shadow.setAttribute("d", pathData);
  shadow.setAttribute("fill", "none");
  shadow.setAttribute("stroke", "rgba(0,0,0,0.15)");
  shadow.setAttribute("stroke-width", shadowWidth);
  shadow.setAttribute("stroke-linecap", "round");
  shadow.style.filter = "blur(0.5px)";

  /* ===== 头发主体 ===== */
  const strand = document.createElementNS(svgNS, "path");
  strand.setAttribute("d", pathData);
  strand.setAttribute("fill", "none");
  strand.setAttribute("stroke", "#1a1a1a");
  strand.setAttribute("stroke-width", strokeWidth);
  strand.setAttribute("stroke-linecap", "round");

  svg.appendChild(shadow);
  svg.appendChild(strand);
  container.appendChild(svg);
  document.body.appendChild(container);

})();
