'use client';

import { useEffect } from 'react';

/**
 * Scrolls to the section the address names (/guide#reviews) once the served sections are on the page: they arrive after
 * the browser looked for it (plan 13, task 13). The heading's own scroll margin keeps it below the sticky header.
 */
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView();
  }, []);
  return null;
}
