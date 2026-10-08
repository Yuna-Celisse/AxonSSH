import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { subscribeTerminal } from "./terminalHub";
export default function TerminalPane({
  id,
  active,
  search,
}: {
  id: string;
  active: boolean;
  search: string;
}) {
  const element = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null),
    finder = useRef<SearchAddon | null>(null);
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      scrollback: 5000,
      theme: {
        background: "#101114",
        foreground: "#c7cbd3",
        cursor: "#db9872",
        selectionBackground: "#424553",
      },
    });
    const fitAddon = new FitAddon(),
      searchAddon = new SearchAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.open(element.current!);
    terminal.current = term;
    fit.current = fitAddon;
    finder.current = searchAddon;
    let closed = false;
    const unsubscribe = subscribeTerminal(id, (event) => {
      if (event.type === "terminal:data") term.write(event.data);
      else if (event.type === "terminal:closed") {
        closed = true;
        term.write(`\r\n[${event.reason}]\r\n`);
      }
    });
    const input = term.onData((data) => {
      if (closed) return;
      for (let i = 0; i < data.length; i += 32768)
        void window.axon.terminal
          .write(id, data.slice(i, i + 32768))
          .catch(() => {
            closed = true;
            term.write("\r\n[终端连接已关闭]\r\n");
          });
    });
    const observer = new ResizeObserver(() => {
      if (element.current && element.current.clientWidth > 0) {
        fitAddon.fit();
        void window.axon.terminal
          .resize(id, term.cols, term.rows)
          .catch(() => {});
      }
    });
    observer.observe(element.current!);
    return () => {
      observer.disconnect();
      unsubscribe();
      input.dispose();
      term.dispose();
      terminal.current = null;
    };
  }, [id]);
  useEffect(() => {
    if (active) {
      fit.current?.fit();
      terminal.current?.focus();
    }
  }, [active]);
  useEffect(() => {
    if (search) finder.current?.findNext(search);
  }, [search]);
  return (
    <div
      className="terminal-canvas"
      ref={element}
      style={{ display: active ? "block" : "none" }}
    />
  );
}
