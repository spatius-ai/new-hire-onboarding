/* Put New hire onboarding inside any web page or web app with one line:
     <script src="https://YOUR-ONBOARDING-ADDRESS/embed.js" async></script>
   Optional starting language (the new hire can still change it):
     data-lang="es"
   It adds the guide in a frame where the line is (no style clash with your page), keeps the frame's
   height right, and passes events on to your page as window "spatius:event" (for your analytics). */
(function () {
  var me = document.currentScript;
  if (!me) return;
  var base = me.src.replace(/embed\.js(\?.*)?$/, '');
  var q = [];
  ['lang'].forEach(function (k) { var v = me.getAttribute('data-' + k); if (v) q.push(k + '=' + encodeURIComponent(v)); });
  var frame = document.createElement('iframe');
  frame.src = base + (q.length ? '?' + q.join('&') : '');
  frame.title = 'New hire onboarding';
  frame.allow = 'microphone; autoplay';
  frame.style.cssText = 'display:block;width:100%;border:0;height:1100px;background:transparent';
  me.parentNode.insertBefore(frame, me);
  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow || !e.data) return;
    if (e.data.type === 'spatius-embed-height') frame.style.height = e.data.height + 'px';
    if (e.data.type === 'spatius-event') window.dispatchEvent(new CustomEvent('spatius:event', { detail: e.data }));
  });
})();
