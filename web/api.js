// Thin API client: attaches the admin bearer key and normalizes errors.

const KEY_STORAGE = 'febc_admin_key';

export function getKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}
export function setKey(k) {
  localStorage.setItem(KEY_STORAGE, k);
}
export function clearKey() {
  localStorage.removeItem(KEY_STORAGE);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function fileForm(file) {
  const fd = new FormData();
  fd.set('image', file);
  return fd;
}

async function handleResponse(res) {
  if (res.status === 401) throw new ApiError('Unauthorized', 401);
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const msg = data?.error || (data?.issues && data.issues.map((i) => `${i.path}: ${i.message}`).join(', ')) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

async function request(method, path, body) {
  const opts = { method, headers: { Authorization: `Bearer ${getKey()}` } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return handleResponse(await fetch(path, opts));
}

/** Multipart POST — let the browser set the content-type/boundary. */
async function requestForm(path, formData) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getKey()}` },
    body: formData,
  });
  return handleResponse(res);
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  postForm: (p, fd) => requestForm(p, fd),
};

// Endpoint helpers
export const Endpoints = {
  stats: () => api.get('/api/stats'),
  pages: () => api.get('/api/pages'),
  refreshPages: () => api.post('/api/pages/refresh'),
  subscribePage: (id) => api.post(`/api/pages/${id}/subscribe`),
  unsubscribePage: (id) => api.del(`/api/pages/${id}/subscribe`),
  setPageActive: (id, isActive) => api.patch(`/api/pages/${id}`, { isActive }),
  deletePage: (id) => api.del(`/api/pages/${id}`),
  setCover: (id, imageUrl) => api.post(`/api/pages/${id}/cover`, { imageUrl }),
  setProfilePicture: (id, imageUrl) => api.post(`/api/pages/${id}/profile-picture`, { imageUrl }),
  setCoverFile: (id, file) => api.postForm(`/api/pages/${id}/cover`, fileForm(file)),
  setProfilePictureFile: (id, file) => api.postForm(`/api/pages/${id}/profile-picture`, fileForm(file)),

  broadcastFeed: (b) => api.post('/api/broadcasts/feed', b),
  broadcastFeedFile: (message, pageIds, file, opts = {}) => {
    const fd = new FormData();
    fd.set('message', message);
    for (const id of pageIds) fd.append('pageIds', id);
    fd.set('image', file);
    if (opts.scheduledAt) fd.set('scheduledAt', opts.scheduledAt);
    return api.postForm('/api/broadcasts/feed', fd);
  },
  broadcastMessenger: (b) => api.post('/api/broadcasts/messenger', b),
  broadcastMessengerFile: (message, pageIds, file, opts = {}) => {
    const fd = new FormData();
    fd.set('message', message);
    for (const id of pageIds) fd.append('pageIds', id);
    fd.set('image', file);
    if (opts.messageTag) fd.set('messageTag', opts.messageTag);
    if (opts.onlyWithin24h !== undefined) fd.set('onlyWithin24h', String(opts.onlyWithin24h));
    if (opts.scheduledAt) fd.set('scheduledAt', opts.scheduledAt);
    return api.postForm('/api/broadcasts/messenger', fd);
  },
  broadcasts: () => api.get('/api/broadcasts'),
  scheduledBroadcasts: () => api.get('/api/broadcasts?status=scheduled'),
  broadcast: (id) => api.get(`/api/broadcasts/${id}`),
  updateBroadcast: (id, body) => api.patch(`/api/broadcasts/${id}`, body),
  resendBroadcast: (id) => api.post(`/api/broadcasts/${id}/resend`),
  cancelBroadcast: (id) => api.del(`/api/broadcasts/${id}`),

  schedules: () => api.get('/api/schedules'),
  schedule: (id) => api.get(`/api/schedules/${id}`),
  createSchedule: (b) => api.post('/api/schedules', b),
  uploadScheduleImage: (file) => {
    const fd = new FormData();
    fd.set('image', file);
    return api.postForm('/api/schedules/image', fd);
  },
  updateSchedule: (id, b) => api.patch(`/api/schedules/${id}`, b),
  deleteSchedule: (id) => api.del(`/api/schedules/${id}`),
  runSchedule: (id) => api.post(`/api/schedules/${id}/run`),
  previewSchedule: (id) => api.post(`/api/schedules/${id}/preview`),

  posts: (q) => api.get('/api/posts' + (q || '')),
  recipients: (q) => api.get('/api/messenger/recipients' + (q || '')),
  syncRecipients: () => api.post('/api/messenger/sync'),

  aiCompose: (body) => api.post('/api/ai/compose', body),
  aiImage: (body) => api.post('/api/ai/image', body),
};
