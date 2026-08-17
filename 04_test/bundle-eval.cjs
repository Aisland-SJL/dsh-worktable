const fs = require("fs");
const vm = require("vm");
const code = fs.readFileSync("E:/AI_Workspace/DeepseekHarness/Projects/dsh-worktable/01_content/lib/client.js", "utf8");
function makeEl() {
  return {
    setAttribute(){}, removeAttribute(){}, appendChild(){}, remove(){}, addEventListener(){},
    removeEventListener(){}, classList: { add(){}, remove(){}, contains(){ return false } },
    getContext(){ return null }, getBoundingClientRect(){ return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } },
    style: {}, dataset: {}, textContent: "", children: [],
  };
}
let registered = null;
const moduleLoader = { load(spec){ registered = spec; } };
const sandbox = { self: null,
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  window: {
    __ModuleLoader__: moduleLoader,
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true },
    innerWidth: 1440, innerHeight: 900, setTimeout, clearTimeout, setInterval, clearInterval,
  },
  __ModuleLoader__: moduleLoader,
  document: {
    createElement(){ return makeEl() },
    head: { appendChild(){}, removeChild(){} },
    body: { appendChild(){} },
    querySelector(){ return null }, querySelectorAll(){ return [] },
    addEventListener(){}, removeEventListener(){},
  },
  localStorage: { getItem(){ return null }, setItem(){}, removeItem(){} },
  CustomEvent: class { constructor(t, o){ this.type = t; this.detail = o && o.detail } },
  ResizeObserver: class { observe(){} disconnect(){} },
  MutationObserver: class { observe(){} disconnect(){} },
  navigator: { userAgent: "bundle-eval/1.0", platform: "Win32" }, location: { protocol: "http:", host: "127.0.0.1:3080" },
  fetch: async () => { throw new Error("no fetch") },
  WebSocket: class {},
  URL: require("url").URL, URLSearchParams: require("url").URLSearchParams,
  TextDecoder: require("util").TextDecoder, TextEncoder: require("util").TextEncoder,
  performance: { now: () => 0 },
};
sandbox.self = sandbox; try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "client.js" });
  console.log("模块作用域执行 OK；已注册:", registered && registered.id);
  if (registered) {
    const fakeRequire = (name) => {
      const stubs = {
        "react": { useState: (v)=>[v,()=>{}], useEffect: ()=>{}, useLayoutEffect: ()=>{}, useMemo: (f)=>f(), useCallback: (f)=>f, useRef: (v)=>({current:v}), createElement: ()=>null, Fragment: null },
        "react/jsx-runtime": { jsx: ()=>({}), jsxs: ()=>({}) },
        "react/jsx-dev-runtime": { jsx: ()=>({}) },
        "@deepseek-ai/dsh-client-ui-slots": {},
        "@deepseek-ai/dsh-client-ui-primitives": {},
        "@deepseek-ai/dsh-client-locale": {},
      };
      if (name in stubs) return stubs[name];
      throw new Error("unexpected require: " + name);
    };
    sandbox.self = sandbox; try {
      const exports = registered.factory(fakeRequire);
      console.log("工厂执行 OK, exports keys:", Object.keys(exports || {}));
    } catch (e) {
      console.log("工厂执行抛错:", e && e.stack ? e.stack.split("\n").slice(0,8).join("\n") : e);
    }
  }
} catch (e) {
  console.log("模块作用域抛错:", e && e.stack ? e.stack.split("\n").slice(0,10).join("\n") : e);
}

