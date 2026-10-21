import { rng } from "./rand";

export type Vec = Float32Array;

export function dist2(a: Vec, b: Vec) {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
  return s;
}

export function nearest(v: Vec, book: Vec[]) {
  let best = 0, bd = Infinity;
  for (let j = 0; j < book.length; j++) {
    const d = dist2(v, book[j]);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

/** k-means with k-means++ seeding, trained on (a sample of) the data. */
export function kmeans(data: Vec[], k: number, iters = 10, seed = 11, maxTrain = 360): Vec[] {
  const rand = rng(seed);
  const train = data.length > maxTrain ? Array.from({ length: maxTrain }, (_, i) => data[Math.floor((i * data.length) / maxTrain)]) : data;
  const dim = train[0].length;
  k = Math.min(k, train.length);
  const cents: Vec[] = [train[Math.floor(rand() * train.length)].slice()];
  const d2 = new Float64Array(train.length).fill(Infinity);
  while (cents.length < k) {
    const last = cents[cents.length - 1];
    let total = 0;
    for (let i = 0; i < train.length; i++) { d2[i] = Math.min(d2[i], dist2(train[i], last)); total += d2[i]; }
    let r = rand() * total, pick = 0;
    for (let i = 0; i < train.length; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
    cents.push(train[pick].slice());
  }
  const assign = new Int32Array(train.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < train.length; i++) assign[i] = nearest(train[i], cents);
    const sums = cents.map(() => new Float32Array(dim));
    const counts = new Int32Array(k);
    for (let i = 0; i < train.length; i++) {
      const s = sums[assign[i]];
      for (let d = 0; d < dim; d++) s[d] += train[i][d];
      counts[assign[i]]++;
    }
    for (let j = 0; j < k; j++) if (counts[j]) for (let d = 0; d < dim; d++) cents[j][d] = sums[j][d] / counts[j];
  }
  return cents;
}

export interface RVQ {
  K: number;
  books: Vec[][]; // per stage
  codes: Int32Array[]; // per stage, per frame
  /** reconstruction after s+1 stages, per frame */
  recon: Vec[][];
  /** mean squared error after s+1 stages */
  mse: number[];
  baseMse: number;
}

/** Residual vector quantisation: each stage quantises what the previous stages missed. */
export function rvq(data: Vec[], K: number, stages: number, seed = 5): RVQ {
  const dim = data[0].length;
  const mean = new Float32Array(dim);
  for (const v of data) for (let d = 0; d < dim; d++) mean[d] += v[d] / data.length;
  const baseMse = data.reduce((a, v) => a + dist2(v, mean), 0) / data.length / dim;
  let residual = data.map((v) => v.slice());
  let acc = data.map(() => new Float32Array(dim));
  const books: Vec[][] = [], codes: Int32Array[] = [], recon: Vec[][] = [], mse: number[] = [];
  for (let s = 0; s < stages; s++) {
    const book = kmeans(residual, K, 10, seed + s * 31);
    const c = new Int32Array(data.length);
    acc = acc.map((a, i) => {
      const j = nearest(residual[i], book);
      c[i] = j;
      const out = a.slice();
      for (let d = 0; d < dim; d++) out[d] += book[j][d];
      return out;
    });
    residual = data.map((v, i) => { const r = new Float32Array(dim); for (let d = 0; d < dim; d++) r[d] = v[d] - acc[i][d]; return r; });
    books.push(book);
    codes.push(c);
    recon.push(acc);
    mse.push(data.reduce((a, v, i) => a + dist2(v, acc[i]), 0) / data.length / dim);
  }
  return { K, books, codes, recon, mse, baseMse };
}

/** Top-2 principal components by power iteration; returns projector. */
export function pca2(data: Vec[]) {
  const dim = data[0].length;
  const mean = new Float32Array(dim);
  for (const v of data) for (let d = 0; d < dim; d++) mean[d] += v[d] / data.length;
  const cov = Array.from({ length: dim }, () => new Float64Array(dim));
  for (const v of data) for (let i = 0; i < dim; i++) { const a = v[i] - mean[i]; for (let j = i; j < dim; j++) cov[i][j] += a * (v[j] - mean[j]); }
  for (let i = 0; i < dim; i++) for (let j = 0; j < i; j++) cov[i][j] = cov[j][i];
  const comps: Float64Array[] = [];
  const rand = rng(2);
  for (let c = 0; c < 2; c++) {
    let v: Float64Array = new Float64Array(dim).map(() => rand() - 0.5);
    for (let it = 0; it < 60; it++) {
      const nv = new Float64Array(dim);
      for (let i = 0; i < dim; i++) { let s = 0; for (let j = 0; j < dim; j++) s += cov[i][j] * v[j]; nv[i] = s; }
      for (const p of comps) { let dot = 0; for (let i = 0; i < dim; i++) dot += nv[i] * p[i]; for (let i = 0; i < dim; i++) nv[i] -= dot * p[i]; }
      const n = Math.hypot(...nv) || 1;
      v = nv.map((x) => x / n);
    }
    comps.push(v);
  }
  return (x: Vec): [number, number] => {
    let a = 0, b = 0;
    for (let d = 0; d < dim; d++) { const z = x[d] - mean[d]; a += z * comps[0][d]; b += z * comps[1][d]; }
    return [a, b];
  };
}

/** Encode data with already-trained residual codebooks. */
export function rvqEncode(data: Vec[], books: Vec[][]) {
  const dim = data[0]?.length ?? 0;
  const codes = books.map(() => new Int32Array(data.length));
  const recon = data.map(() => new Float32Array(dim));
  data.forEach((v, i) => {
    const res = v.slice();
    books.forEach((book, s) => {
      const j = nearest(res, book);
      codes[s][i] = j;
      for (let d = 0; d < dim; d++) { recon[i][d] += book[j][d]; res[d] -= book[j][d]; }
    });
  });
  return { codes, recon };
}
