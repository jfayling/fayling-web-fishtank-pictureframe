// Minimal glTF 2.0 / GLB importer for fish models.
//
// Reads triangle meshes (POSITION, NORMAL, TEXCOORD_0, JOINTS_0, WEIGHTS_0, indices) from the
// default scene with node transforms applied, the base colour texture of the first material,
// and the names of any animation clips. Compressed content goes through decoders that the
// page registers:
//   registerDecoder('KHR_draco_mesh_compression', async (bytes, attributeIds, primitive) => ({ POSITION, NORMAL, TEXCOORD_0, indices }))
//   registerDecoder('KHR_texture_basisu', async (bytes) => ImageBitmap)
// A model that needs an unregistered decoder is rejected and the procedural fish is kept.
import { FISH_STRIDE } from './fish-mesh.js';

const decoders = {};
export function registerDecoder(extension, fn) { decoders[extension] = fn; }

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

export async function loadGltf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  let json, bin = null;
  if (dv.getUint32(0, true) === 0x46546c67) {
    let off = 12;
    while (off < buf.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      const chunk = buf.slice(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) bin = chunk;
      off += 8 + len;
    }
  } else {
    json = JSON.parse(new TextDecoder().decode(buf));
  }
  for (const ext of json.extensionsRequired || []) {
    if (!decoders[ext] && ext !== 'KHR_materials_unlit' && ext !== 'KHR_texture_transform') {
      throw new Error(`${url} requires ${ext}; register a decoder for it`);
    }
  }
  const base = new URL(url, location.href);
  const buffers = await Promise.all((json.buffers || []).map(async (b, i) => {
    if (b.uri === undefined) return i === 0 ? bin : null;
    const r = await fetch(new URL(b.uri, base));
    return r.arrayBuffer();
  }));
  const viewBytes = (vi) => {
    const v = json.bufferViews[vi];
    return new Uint8Array(buffers[v.buffer], v.byteOffset || 0, v.byteLength);
  };
  const accessor = (ai) => {
    const a = json.accessors[ai];
    const n = COMPONENTS[a.type], T = ARRAYS[a.componentType];
    const out = new Float32Array(a.count * n);
    if (a.bufferView === undefined) return { data: out, n };
    const v = json.bufferViews[a.bufferView];
    const bytes = viewBytes(a.bufferView);
    const stride = v.byteStride || n * T.BYTES_PER_ELEMENT;
    const src = new DataView(bytes.buffer, bytes.byteOffset + (a.byteOffset || 0));
    const get = {
      5120: (o) => src.getInt8(o), 5121: (o) => src.getUint8(o), 5122: (o) => src.getInt16(o, true),
      5123: (o) => src.getUint16(o, true), 5125: (o) => src.getUint32(o, true), 5126: (o) => src.getFloat32(o, true),
    }[a.componentType];
    const norm = a.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType] || 1 : 1;
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < n; c++) out[i * n + c] = get(i * stride + c * T.BYTES_PER_ELEMENT) / norm;
    }
    return { data: out, n };
  };

  const positions = [], normals = [], uvs = [], indices = [];
  const addPrimitive = async (prim, M) => {
    let attrs;
    const draco = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
    if (draco) {
      if (!decoders.KHR_draco_mesh_compression) throw new Error('Draco geometry needs a registered decoder');
      attrs = await decoders.KHR_draco_mesh_compression(viewBytes(draco.bufferView), draco.attributes, prim);
    } else {
      attrs = {
        POSITION: accessor(prim.attributes.POSITION).data,
        NORMAL: prim.attributes.NORMAL !== undefined ? accessor(prim.attributes.NORMAL).data : null,
        TEXCOORD_0: prim.attributes.TEXCOORD_0 !== undefined ? accessor(prim.attributes.TEXCOORD_0).data : null,
        indices: prim.indices !== undefined ? accessor(prim.indices).data : null,
      };
    }
    const base = positions.length / 3;
    const P = attrs.POSITION, Nn = attrs.NORMAL, T = attrs.TEXCOORD_0;
    const count = P.length / 3;
    for (let i = 0; i < count; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      positions.push(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
      if (Nn) {
        const a = Nn[i * 3], b = Nn[i * 3 + 1], c = Nn[i * 3 + 2];
        normals.push(M[0] * a + M[4] * b + M[8] * c, M[1] * a + M[5] * b + M[9] * c, M[2] * a + M[6] * b + M[10] * c);
      } else normals.push(0, 0, 0);
      uvs.push(T ? T[i * 2] : 0, T ? T[i * 2 + 1] : 0);
    }
    const I = attrs.indices || Array.from({ length: count }, (_, i) => i);
    for (let i = 0; i < I.length; i++) indices.push(base + I[i]);
  };
  const mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  };
  const localMatrix = (node) => {
    if (node.matrix) return Float32Array.from(node.matrix);
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const [qx, qy, qz, qw] = node.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    return Float32Array.from([
      (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
      2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
      2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
      tx, ty, tz, 1,
    ]);
  };
  const visit = async (ni, parent) => {
    const node = json.nodes[ni];
    const M = mul(parent, localMatrix(node));
    if (node.mesh !== undefined) for (const prim of json.meshes[node.mesh].primitives) if ((prim.mode ?? 4) === 4) await addPrimitive(prim, M);
    for (const c of node.children || []) await visit(c, M);
  };
  const I4 = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const scene = json.scenes ? json.scenes[json.scene || 0] : { nodes: json.nodes.map((_, i) => i) };
  for (const ni of scene.nodes) await visit(ni, I4);

  // base colour texture of the first textured material
  let image = null;
  const mat = (json.materials || []).find((m) => m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture);
  if (mat) {
    const tex = json.textures[mat.pbrMetallicRoughness.baseColorTexture.index];
    const basis = tex.extensions && tex.extensions.KHR_texture_basisu;
    const img = json.images[basis ? basis.source : tex.source];
    const bytes = img.bufferView !== undefined ? viewBytes(img.bufferView) : new Uint8Array(await (await fetch(new URL(img.uri, base))).arrayBuffer());
    if (basis || img.mimeType === 'image/ktx2') {
      if (decoders.KHR_texture_basisu) image = await decoders.KHR_texture_basisu(bytes);
    } else {
      image = await createImageBitmap(new Blob([bytes], { type: img.mimeType || 'image/png' }), { imageOrientation: 'none' });
    }
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices), image, clips: (json.animations || []).map((a) => a.name || 'clip'),
  };
}

// Fit an imported model to the fish frame: body length 1 along +x with the snout forward,
// then derive the body coordinates the procedural animation and shading expect.
export function fishMeshFromModel(model, def, opts = {}) {
  const P = model.positions, n = P.length / 3;
  const axis = opts.forward || '+x';
  const ax = { x: 0, y: 1, z: 2 }[axis[1]], sign = axis[0] === '-' ? -1 : 1;
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], P[i * 3 + c]); max[c] = Math.max(max[c], P[i * 3 + c]); }
  const len = max[ax] - min[ax] || 1;
  const pivot = def.geo.pivot ?? 0.4;
  const side = ax === 2 ? 0 : 2;
  const cy = (min[1] + max[1]) / 2, cs = (min[side] + max[side]) / 2;
  const halfH = (max[1] - min[1]) / 2 / len || 1;
  const v = new Float32Array(n * FISH_STRIDE);
  for (let i = 0; i < n; i++) {
    const fwd = (P[i * 3 + ax] - (sign > 0 ? max[ax] : min[ax])) * sign / len; // 0 at the snout, negative backward
    const y = (P[i * 3 + 1] - cy) / len, z = ((P[i * 3 + side] - cs) / len) * (ax === 2 ? 1 : sign);
    const t = -fwd;
    const o = i * FISH_STRIDE;
    v[o] = pivot - t; v[o + 1] = y; v[o + 2] = z;
    const N = model.normals;
    v[o + 3] = N[i * 3 + ax] * sign; v[o + 4] = N[i * 3 + 1]; v[o + 5] = N[i * 3 + side];
    v[o + 6] = t; v[o + 7] = y;
    v[o + 8] = 0; v[o + 9] = Math.sign(z); v[o + 10] = y / halfH; v[o + 11] = 0;
    v[o + 12] = model.uvs[i * 2]; v[o + 13] = model.uvs[i * 2 + 1];
  }
  return { vertices: v, indices: model.indices, image: model.image, clips: model.clips, pivot };
}
