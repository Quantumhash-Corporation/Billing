async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('The dashboard server is not answering. Check that it is running.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fallback =
      res.status >= 500
        ? 'The dashboard server is not answering. Check that it is running.'
        : `The server answered ${res.status}.`;
    const error = new Error(data.error || fallback);
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  session: () => request('GET', '/session'),
  login: (password) => request('POST', '/login', { password }),
  logout: () => request('POST', '/logout'),
  overview: () => request('GET', '/overview'),
  sync: (service) => request('POST', '/sync', service ? { service } : {}),
  reconnect: (id) => request('POST', `/services/${id}/reconnect`),
  detail: (id) => request('GET', `/services/${id}`),
  saveSettings: (id, settings) => request('PUT', `/services/${id}`, settings),
  addEntry: (id, entry) => request('POST', `/services/${id}/ledger`, entry),
  removeEntry: (id, entryId) => request('DELETE', `/services/${id}/ledger/${entryId}`),
};
