import React from 'react';
import { createRoot } from 'react-dom/client';
import { Agentation } from 'agentation';

const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (localHosts.has(window.location.hostname)) {
  const container = document.createElement('div');
  container.id = 'agentation-toolbar';
  document.body.appendChild(container);
  createRoot(container).render(<Agentation />);
}
