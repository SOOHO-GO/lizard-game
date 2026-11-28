param([string]$Src, [string]$OutRoot, [string]$Only = "", [string]$Files = "")
# 노멀 게코 그림의 노란 몸통/검은 무늬를 모프 색으로 바꾼다 (배·발·혀·눈은 그대로)
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class Recolor {
  static double Smooth(double x, double a, double b) { double t = (x - a) / (b - a); if (t < 0) t = 0; if (t > 1) t = 1; return t * t * (3 - 2 * t); }
  static void ToHsl(double r, double g, double b, out double h, out double s, out double l) {
    double mx = Math.Max(r, Math.Max(g, b)), mn = Math.Min(r, Math.Min(g, b)); l = (mx + mn) / 2; double d = mx - mn;
    if (d < 1e-6) { h = 0; s = 0; return; }
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx == r) h = ((g - b) / d + (g < b ? 6 : 0)); else if (mx == g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60;
  }
  static double Hue(double p, double q, double t) { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1.0/6) return p + (q - p) * 6 * t; if (t < 0.5) return q; if (t < 2.0/3) return p + (q - p) * (2.0/3 - t) * 6; return p; }
  static void FromHsl(double h, double s, double l, out double r, out double g, out double b) {
    if (s < 1e-6) { r = g = b = l; return; } double q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, hh = h / 360;
    r = Hue(p, q, hh + 1.0/3); g = Hue(p, q, hh); b = Hue(p, q, hh - 1.0/3);
  }
  static float[] BoxBlur(float[] a, int w, int h, int r) {
    float[] t = new float[a.Length], o = new float[a.Length];
    for (int y = 0; y < h; y++) { double s = 0; int n = 0; for (int x = -r; x < w + r; x++) { int add = x + r, rem = x - r - 1; if (add < w && add >= 0) { s += a[y * w + add]; n++; } if (rem >= 0) { s -= a[y * w + rem]; n--; } if (x >= 0 && x < w) t[y * w + x] = (float)(s / Math.Max(1, n)); } }
    for (int x = 0; x < w; x++) { double s = 0; int n = 0; for (int y = -r; y < h + r; y++) { int add = y + r, rem = y - r - 1; if (add < h && add >= 0) { s += t[add * w + x]; n++; } if (rem >= 0) { s -= t[rem * w + x]; n--; } if (y >= 0 && y < h) o[y * w + x] = (float)(s / Math.Max(1, n)); } }
    return o;
  }
  // body/spot: target colors (0..1). spotMix: blend spots toward body (1 = patternless)
  public static void Run(string src, string dst, double br, double bg, double bb, double sr, double sg, double sb, double spotMix) {
    using (Bitmap bmp = new Bitmap(src)) {
      int w = bmp.Width, h = bmp.Height;
      Bitmap img = new Bitmap(w, h, PixelFormat.Format32bppArgb);
      using (Graphics gr = Graphics.FromImage(img)) gr.DrawImage(bmp, 0, 0, w, h);
      BitmapData bd = img.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      byte[] px = new byte[bd.Stride * h]; Marshal.Copy(bd.Scan0, px, 0, px.Length);
      int n = w * h; float[] yel = new float[n], drk = new float[n], warm = new float[n];
      double[] H = new double[n], S = new double[n], L = new double[n];
      for (int i = 0; i < n; i++) {
        int k = (i / w) * bd.Stride + (i % w) * 4; double a = px[k + 3] / 255.0;
        double r = px[k + 2] / 255.0, g = px[k + 1] / 255.0, b = px[k] / 255.0, hh, ss, ll; ToHsl(r, g, b, out hh, out ss, out ll);
        H[i] = hh; S[i] = ss; L[i] = ll;
        double hueW = Smooth(hh, 18, 30) * (1 - Smooth(hh, 62, 75));
        yel[i] = (float)(a * hueW * Smooth(ss, 0.28, 0.5) * Smooth(ll, 0.3, 0.45));
        warm[i] = (float)(Smooth(hh, 2, 10) * (1 - Smooth(hh, 80, 95)) * Smooth(ss, 0.06, 0.14));
        drk[i] = (float)(a * (1 - Smooth(ll, 0.3, 0.6)) * (1 - 0.6 * hueW * Smooth(ss, 0.45, 0.7) * Smooth(ll, 0.4, 0.55)));
      }
      float[] near = BoxBlur(BoxBlur(yel, w, h, 9), w, h, 9); float[] far = BoxBlur(BoxBlur(yel, w, h, 22), w, h, 22);
      double tbh, tbs, tbl, tsh, tss, tsl; ToHsl(br, bg, bb, out tbh, out tbs, out tbl); ToHsl(sr, sg, sb, out tsh, out tss, out tsl);
      for (int i = 0; i < n; i++) {
        int k = (i / w) * bd.Stride + (i % w) * 4; if (px[k + 3] == 0) continue;
        double r = px[k + 2] / 255.0, g = px[k + 1] / 255.0, b = px[k] / 255.0;
        // body: keep original shading around L=0.62
        double yw = yel[i], nr, ng, nb;
        if (yw > 0.001) {
          double l2 = Math.Max(0, Math.Min(1, tbl + (L[i] - 0.62) * (tbl > 0.85 ? 0.35 : 0.9)));
          FromHsl(tbh, tbs * Math.Min(1.2, S[i] / 0.75), l2, out nr, out ng, out nb);
          r += (nr - r) * yw; g += (ng - g) * yw; b += (nb - b) * yw;
        }
        // spots: only dark pixels surrounded by yellow body (eyes/mouth untouched)
        double sw = drk[i] * Math.Max(Smooth(near[i], 0.12, 0.3), warm[i] * Smooth(far[i], 0.03, 0.1));
        if (sw > 0.001) {
          double l2 = Math.Max(0, Math.Min(1, tsl + (L[i] - 0.15) * 0.8)), mr, mg, mb;
          FromHsl(tsh, tss, l2, out mr, out mg, out mb);
          if (spotMix > 0) { double l3 = Math.Max(0, Math.Min(1, tbl - 0.04 + (L[i] - 0.15) * 0.3)); FromHsl(tbh, tbs, l3, out nr, out ng, out nb); mr += (nr - mr) * spotMix; mg += (ng - mg) * spotMix; mb += (nb - mb) * spotMix; }
          r += (mr - r) * sw; g += (mg - g) * sw; b += (mb - b) * sw;
        }
        px[k + 2] = (byte)Math.Round(Math.Max(0, Math.Min(1, r)) * 255); px[k + 1] = (byte)Math.Round(Math.Max(0, Math.Min(1, g)) * 255); px[k] = (byte)Math.Round(Math.Max(0, Math.Min(1, b)) * 255);
      }
      Marshal.Copy(px, 0, bd.Scan0, px.Length); img.UnlockBits(bd);
      img.Save(dst, ImageFormat.Png); img.Dispose();
    }
  }
}
"@
function ConvertFrom-Hex([string]$code) {
  $c = $code.TrimStart('#')
  $out = New-Object double[] 3
  for ($j = 0; $j -lt 3; $j++) { $out[$j] = [Convert]::ToInt32($c.Substring($j * 2, 2), 16) / 255.0 }
  return ,$out
}
# key, 몸 색, 무늬 색, 무늬 섞기(0~1)
$M = @(
  @("mint","#7fd8b4","#1d4a3a",0), @("cherry","#e24a5c","#4a0f1a",0), @("ocean","#3a9fdc","#0c2c4a",0), @("peach","#ffb48c","#7a3a22",0),
  @("lemonfrost","#fff27a","#8a7a20",0.35), @("raptor","#f27a28","#5a2408",0), @("diablo","#f4eee4","#d9cfbf",0.85), @("bandit","#dca13c","#1a1410",0),
  @("enigma","#cbb07c","#6e5638",0.2), @("firewater","#ff5422","#3a0c04",0), @("aurora","#8c7ef2","#251c5e",0), @("rose","#f28ab8","#6a1c46",0),
  @("emerald","#2fae60","#0c381c",0), @("ice","#cfe8f6","#4e7088",0), @("lime","#b8e04c","#364810",0), @("storm","#8fa2b6","#1c2834",0)
)
$names = if ($Files) { $Files -split ',' } else { foreach ($s in "hatchling","juvenile","adult") { foreach ($f in "happy","ok","sad","sleep") { "${s}_$f" } } }
foreach ($m in $M) {
  if ($Only -and ($Only -split ',') -notcontains $m[0]) { continue }
  $dir = Join-Path $OutRoot $m[0]; New-Item -ItemType Directory -Force $dir | Out-Null
  $b = ConvertFrom-Hex $m[1]; $s = ConvertFrom-Hex $m[2]
  foreach ($nm in $names) { [Recolor]::Run((Join-Path $Src "$nm.png"), (Join-Path $dir "$nm.png"), $b[0],$b[1],$b[2], $s[0],$s[1],$s[2], [double]$m[3]) }
  "done $($m[0])"
}




