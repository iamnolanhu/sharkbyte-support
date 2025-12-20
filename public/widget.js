(function() {
  'use strict';

  // Get configuration from script tag
  var script = document.currentScript;
  if (!script) {
    console.error('SharkByte Widget: Could not find script tag');
    return;
  }

  var config = {
    agentId: script.getAttribute('data-agent-id'),
    endpoint: script.getAttribute('data-endpoint'),
    accessKey: script.getAttribute('data-access-key'),
    primaryColor: script.getAttribute('data-primary-color') || '#0080FF',
    position: script.getAttribute('data-position') || 'bottom-right',
    welcomeMessage: script.getAttribute('data-welcome-message') || '',
  };

  // Validate required config
  if (!config.agentId) {
    console.error('SharkByte Widget: data-agent-id is required');
    return;
  }
  if (!config.endpoint || !config.accessKey) {
    console.error('SharkByte Widget: data-endpoint and data-access-key are required');
    return;
  }

  // Derive base URL from script src (future-proof for domain changes)
  var scriptSrc = script.src;
  var baseUrl = scriptSrc.substring(0, scriptSrc.lastIndexOf('/'));
  // Handle case where widget.js is at root
  if (baseUrl.endsWith('/widget.js')) {
    baseUrl = baseUrl.replace('/widget.js', '');
  }

  // Track widget state
  var isMaximized = false;

  // Create container
  var container = document.createElement('div');
  container.id = 'sharkbyte-widget-container';
  container.style.cssText = [
    'position: fixed',
    'bottom: 16px',
    config.position === 'bottom-right' ? 'right: 16px' : 'left: 16px',
    'z-index: 2147483647',
    'width: 70px',
    'height: 70px',
    'transition: all 0.3s ease',
  ].join(';');

  // Create iframe
  var iframe = document.createElement('iframe');
  var params = new URLSearchParams({
    endpoint: config.endpoint,
    accessKey: config.accessKey,
    color: config.primaryColor,
    position: config.position,
  });
  if (config.welcomeMessage) {
    params.append('welcome', config.welcomeMessage);
  }

  iframe.src = baseUrl + '/embed/' + config.agentId + '?' + params.toString();
  iframe.style.cssText = [
    'width: 100%',
    'height: 100%',
    'border: none',
    'background: transparent',
    'border-radius: 16px',
  ].join(';');
  iframe.allow = 'clipboard-write';
  iframe.title = 'SharkByte Chat Widget';

  // Handle postMessage from widget
  window.addEventListener('message', function(event) {
    // Verify origin - check if it matches our base URL
    if (!event.origin || event.origin !== new URL(baseUrl).origin) return;

    var data = event.data;
    if (!data || !data.type) return;

    if (data.type === 'sharkbyte:open') {
      isMaximized = false;
      container.style.position = 'fixed';
      container.style.inset = '';
      container.style.bottom = '16px';
      container.style[config.position === 'bottom-right' ? 'right' : 'left'] = '16px';
      container.style.width = (data.payload.width || 380) + 'px';
      container.style.height = (data.payload.height || 520) + 'px';
      iframe.style.borderRadius = '16px';
    } else if (data.type === 'sharkbyte:close') {
      isMaximized = false;
      container.style.position = 'fixed';
      container.style.inset = '';
      container.style.bottom = '16px';
      container.style[config.position === 'bottom-right' ? 'right' : 'left'] = '16px';
      container.style.width = (data.payload.width || 70) + 'px';
      container.style.height = (data.payload.height || 70) + 'px';
      iframe.style.borderRadius = '16px';
    } else if (data.type === 'sharkbyte:maximize') {
      isMaximized = true;
      container.style.position = 'fixed';
      container.style.inset = '0';
      container.style.bottom = '';
      container.style.right = '';
      container.style.left = '';
      container.style.width = '100%';
      container.style.height = '100%';
      iframe.style.borderRadius = '0';
    } else if (data.type === 'sharkbyte:resize') {
      if (data.payload.width) container.style.width = data.payload.width + 'px';
      if (data.payload.height) container.style.height = data.payload.height + 'px';
    }
  });

  // Append iframe to container
  container.appendChild(iframe);

  // Append container to body when DOM is ready
  function init() {
    document.body.appendChild(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
