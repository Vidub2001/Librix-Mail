// Fichier de test des règles librix-ts.yml (semgrep --test), jamais compilé.

function sinks(el: HTMLElement, html: string) {
  // ruleid: librix-raw-html-sink
  el.innerHTML = html;
  // ruleid: librix-raw-html-sink
  el.outerHTML = html;
  // ruleid: librix-raw-html-sink
  el.insertAdjacentHTML("beforeend", html);
  // ruleid: librix-raw-html-sink
  const props = { dangerouslySetInnerHTML: { __html: html } };
  // ruleid: librix-raw-html-sink
  const fragment = document.createRange().createContextualFragment(html);
  // ruleid: librix-raw-html-sink
  document.execCommand("insertHTML", false, html);
  // ruleid: librix-raw-html-sink
  const frame = <iframe srcDoc={html} />;
  // ruleid: librix-raw-html-sink
  (el as HTMLIFrameElement).srcdoc = html;
  // ruleid: librix-raw-html-sink
  el.innerHTML += html;
  // ruleid: librix-raw-html-sink
  el.setAttribute("srcdoc", html);
  // ruleid: librix-raw-html-sink
  (el as HTMLIFrameElement).contentDocument?.write(html);
  // ruleid: librix-raw-html-sink
  window.open("about:blank")?.document.write(html);
  // ok: librix-raw-html-sink
  el.setAttribute("title", html);
  // ok: librix-raw-html-sink
  document.execCommand("insertText", false, html);
  // ok: librix-raw-html-sink
  el.textContent = html;
  // ok: librix-raw-html-sink
  const copy = el.innerHTML;
  return [props, copy, fragment, frame];
}

function reparse(html: string) {
  // ruleid: librix-html-reparse
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parser = new DOMParser();
  // ruleid: librix-html-reparse
  const again = parser.parseFromString(html, "text/html");
  return [doc, again];
}
