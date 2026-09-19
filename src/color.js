'use strict';

// 颜色科学工具：sRGB -> 线性 RGB -> XYZ -> Lab，WCAG 对比度，CIEDE2000 色差

function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim();
  if (h[0] === '#') h = h.slice(1);
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

// sRGB 分量(0-255) -> 线性
function srgbChannelToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }) {
  const R = srgbChannelToLinear(r);
  const G = srgbChannelToLinear(g);
  const B = srgbChannelToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

// WCAG 2.x 对比度
function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

// XYZ (D65) -> Lab
function rgbToLab(rgb) {
  let R = srgbChannelToLinear(rgb.r);
  let G = srgbChannelToLinear(rgb.g);
  let B = srgbChannelToLinear(rgb.b);

  // sRGB -> XYZ (D65)
  let X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  let Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  let Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;

  // D65 白点
  X /= 0.95047;
  Y /= 1.0;
  Z /= 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

// CIEDE2000 色差（含权重 kL=kC=kH=1），参考 Sharma et al. 2005
function deltaE2000(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const ap1 = a1 * (1 + G);
  const ap2 = a2 * (1 + G);

  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);

  const hp = (ap, bb) => {
    if (ap === 0 && bb === 0) return 0;
    let h = (Math.atan2(bb, ap) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  };
  const hp1 = hp(ap1, b1);
  const hp2 = hp(ap2, b2);

  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;

  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * Math.PI) / 360);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (Cp1 + Cp2) / 2;

  let hbp = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > 180) {
      if (hp1 + hp2 < 360) hbp = (hp1 + hp2 + 360) / 2;
      else hbp = (hp1 + hp2 - 360) / 2;
    } else {
      hbp = (hp1 + hp2) / 2;
    }
  }

  const T =
    1 -
    0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * hbp) * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180);

  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin((2 * dTheta * Math.PI) / 180) * RC;

  const kL = 1,
    kC = 1,
    kH = 1;
  const termL = dLp / (kL * SL);
  const termC = dCp / (kC * SC);
  const termH = dHp / (kH * SH);
  return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH);
}

module.exports = { parseHex, toHex, relativeLuminance, contrastRatio, rgbToLab, deltaE2000 };
