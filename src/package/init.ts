import { Module } from "./modules/module";
import { vnode, VNode } from "./vnode";
import * as is from "./is";
import { htmlDomApi, DOMAPI } from "./htmldomapi";

type NonUndefined<T> = T extends undefined ? never : T;
// 判断是否不是undefined
function isUndef(s: any): boolean {
  return s === undefined;
}
// 判断是否为undefined
function isDef<A>(s: A): s is NonUndefined<A> {
  return s !== undefined;
}

type VNodeQueue = VNode[];

const emptyNode = vnode("", {}, [], undefined, undefined);
// 判断是否是同一个虚拟节点
function sameVnode(vnode1: VNode, vnode2: VNode): boolean {
  return vnode1.key === vnode2.key && vnode1.sel === vnode2.sel;
}
// 判断是否是虚拟节点
function isVnode(vnode: any): vnode is VNode {
  return vnode.sel !== undefined;
}

type KeyToIndexMap = { [key: string]: number };

type ArraysOf<T> = {
  [K in keyof T]: Array<T[K]>;
};

type ModuleHooks = ArraysOf<Required<Module>>;

function createKeyToOldIdx(
  children: VNode[],
  beginIdx: number,
  endIdx: number
): KeyToIndexMap {
  const map: KeyToIndexMap = {};
  for (let i = beginIdx; i <= endIdx; ++i) {
    const key = children[i]?.key;
    if (key !== undefined) {
      map[key] = i;
    }
  }
  return map;
}

const hooks: Array<keyof Module> = [
  "create",
  "update",
  "remove",
  "destroy",
  "pre",
  "post",
];

export function init(modules: Array<Partial<Module>>, domApi?: DOMAPI) {
  let i: number;
  let j: number;
  const cbs: ModuleHooks = {
    create: [],
    update: [],
    remove: [],
    destroy: [],
    pre: [],
    post: [],
  };

  const api: DOMAPI = domApi !== undefined ? domApi : htmlDomApi;
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = [];
    for (j = 0; j < modules.length; ++j) {
      const hook = modules[j][hooks[i]];
      if (hook !== undefined) {
        (cbs[hooks[i]] as any[]).push(hook);
      }
    }
  }
  // 根据dom节点得到一个虚拟dom节点
  function emptyNodeAt(elm: Element) {
    const id = elm.id ? "#" + elm.id : "";
    const c = elm.className ? "." + elm.className.split(" ").join(".") : "";
    return vnode(
      api.tagName(elm).toLowerCase() + id + c,
      {},
      [],
      undefined,
      elm
    );
  }
  function createRmCb(childElm: Node, listeners: number) {
    return function rmCb() {
      if (--listeners === 0) {
        const parent = api.parentNode(childElm) as Node;
        api.removeChild(parent, childElm);
      }
    };
  }
/* 
职责：为vnode初始化ele属性
1.执行用户设置的init钩子函数
2.把vnode转换成真实dom对象
3.返回新建的dom，并挂载在vnode的ele属性上
*/
  function createElm(vnode: VNode, insertedVnodeQueue: VNodeQueue): Node {
    let i: any;
    let data = vnode.data;
    if (data !== undefined) {
      const init = data.hook?.init;
      if (isDef(init)) {
        init(vnode);
        data = vnode.data;
      }
    }
    const children = vnode.children;
    const sel = vnode.sel;
    if (sel === "!") {  // type1：注释节点类型的创建
      if (isUndef(vnode.text)) {
        vnode.text = "";
      }
      vnode.elm = api.createComment(vnode.text!);
    } else if (sel !== undefined) { // type2、3：元素节点和id、class属性节点的创建（其它的属性节点在钩子模块的钩子中创建）
      // 假设sel = "#ii.c1.c2"
      const hashIdx = sel.indexOf("#"); // hashIdx = 0
      const dotIdx = sel.indexOf(".", hashIdx); // dotIdx = 3
      const hash = hashIdx > 0 ? hashIdx : sel.length;  // hash = 9
      const dot = dotIdx > 0 ? dotIdx : sel.length; // dot = 3
      const tag =
        hashIdx !== -1 || dotIdx !== -1
          ? sel.slice(0, Math.min(hash, dot))
          : sel;  // tag = "#ii"
      const elm = (vnode.elm =
        isDef(data) && isDef((i = data.ns))
          ? api.createElementNS(i, tag)
          : api.createElement(tag));  // elm = 一个带id属性的空节点
      if (hash < dot) elm.setAttribute("id", sel.slice(hash + 1, dot)); // 为elm设置属性：id = "ii"
      if (dotIdx > 0)
        elm.setAttribute("class", sel.slice(dot + 1).replace(/\./g, " "));  // 为elm设置属性：class = "c1 c2"
      // 总结1：经过以上操作，sel属性解析完成，创建了一个带id属性和class属性的空元素节点
      for (i = 0; i < cbs.create.length; ++i) cbs.create[i](emptyNode, vnode);
      if (is.array(children)) { // 递归创建元素子节点并挂载在该元素上
        for (i = 0; i < children.length; ++i) {
          const ch = children[i];
          if (ch != null) {
            api.appendChild(elm, createElm(ch as VNode, insertedVnodeQueue));
          }
        }
      } else if (is.primitive(vnode.text)) {
        api.appendChild(elm, api.createTextNode(vnode.text));
      }
      const hook = vnode.data!.hook;
      if (isDef(hook)) {
        hook.create?.(emptyNode, vnode);
        if (hook.insert) {
          insertedVnodeQueue.push(vnode);
        }
      }
    } else {  // type4：文本节点的创建
      vnode.elm = api.createTextNode(vnode.text!);
    }
    return vnode.elm;
  }

  function addVnodes(
    parentElm: Node,
    before: Node | null,
    vnodes: VNode[],
    startIdx: number,
    endIdx: number,
    insertedVnodeQueue: VNodeQueue
  ) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx];
      if (ch != null) {
        api.insertBefore(parentElm, createElm(ch, insertedVnodeQueue), before);
      }
    }
  }
  function invokeDestroyHook(vnode: VNode) {
    const data = vnode.data;
    if (data !== undefined) {
      data?.hook?.destroy?.(vnode);
      for (let i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode);
      if (vnode.children !== undefined) {
        for (let j = 0; j < vnode.children.length; ++j) {
          const child = vnode.children[j];
          if (child != null && typeof child !== "string") {
            invokeDestroyHook(child);
          }
        }
      }
    }
  }

  function removeVnodes(
    parentElm: Node,
    vnodes: VNode[],
    startIdx: number,
    endIdx: number
  ): void {
    for (; startIdx <= endIdx; ++startIdx) {
      let listeners: number;
      let rm: () => void;
      const ch = vnodes[startIdx];
      if (ch != null) {
        if (isDef(ch.sel)) {
          invokeDestroyHook(ch);
          listeners = cbs.remove.length + 1;
          rm = createRmCb(ch.elm!, listeners);
          for (let i = 0; i < cbs.remove.length; ++i) cbs.remove[i](ch, rm);
          // 唤起当前节点的remove钩子
          const removeHook = ch?.data?.hook?.remove;
          if (isDef(removeHook)) {
            removeHook(ch, rm);
          } else {
            rm();
          }
        } else {
          // Text node
          api.removeChild(parentElm, ch.elm!);
        }
      }
    }
  }

  function updateChildren(
    parentElm: Node,
    oldCh: VNode[],
    newCh: VNode[],
    insertedVnodeQueue: VNodeQueue
  ) {
    let oldStartIdx = 0;
    let newStartIdx = 0;
    let oldEndIdx = oldCh.length - 1;
    let oldStartVnode = oldCh[0];
    let oldEndVnode = oldCh[oldEndIdx];
    let newEndIdx = newCh.length - 1;
    let newStartVnode = newCh[0];
    let newEndVnode = newCh[newEndIdx];
    let oldKeyToIdx: KeyToIndexMap | undefined;
    let idxInOld: number;
    let elmToMove: VNode;
    let before: any;

    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (oldStartVnode == null) {
        oldStartVnode = oldCh[++oldStartIdx]; // Vnode might have been moved left
      } else if (oldEndVnode == null) {
        oldEndVnode = oldCh[--oldEndIdx];
      } else if (newStartVnode == null) {
        newStartVnode = newCh[++newStartIdx];
      } else if (newEndVnode == null) {
        newEndVnode = newCh[--newEndIdx];
      } 
      // 经过以上四个步骤之后，能够确保oldStartVnode、oldEndVnode、newStartVnode、newEndVnode都不为null，防止children数组中有null
      else if (sameVnode(oldStartVnode, newStartVnode)) { // 1.新旧开始节点相同，保留并更新老的children dom节点
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue);
        oldStartVnode = oldCh[++oldStartIdx];
        newStartVnode = newCh[++newStartIdx];
      } else if (sameVnode(oldEndVnode, newEndVnode)) { // 2.新旧结束节点相同，保留并更新该老的children dom节点
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue);
        oldEndVnode = oldCh[--oldEndIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldStartVnode, newEndVnode)) { // 3.老开始节点和新结束节点相同，用新结束节点更新老开始节点，并把老开始节点移动到老结束节点之前
        // Vnode moved right
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue);
        api.insertBefore(
          parentElm,
          oldStartVnode.elm!,
          api.nextSibling(oldEndVnode.elm!)
        );
        oldStartVnode = oldCh[++oldStartIdx];
        newEndVnode = newCh[--newEndIdx];
      } else if (sameVnode(oldEndVnode, newStartVnode)) { // 4.老结束节点和新开始节点相同，用新开始节点更新老结束节点，把老结束节点放到老开始节点之前
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue);
        api.insertBefore(parentElm, oldEndVnode.elm!, oldStartVnode.elm!);
        oldEndVnode = oldCh[--oldEndIdx];
        newStartVnode = newCh[++newStartIdx];
      } else {  // 5.普适情况
        // 下面用新开始节点的key来匹配所有剩余老节点的key以找到dom。问题：为什么不直接用sel？sel相同并不意味着vnode相同（需要key和sel都相同）
        if (oldKeyToIdx === undefined) {  // 找到所有剩下（被上述四种特殊情况过滤后）的老节点的key id映射对象
          oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx);
        }
        idxInOld = oldKeyToIdx[newStartVnode.key as string];
        if (isUndef(idxInOld)) {  // type1.没有对应的老节点（key不同），需要创建dom对象并插入到老开始节点之前（因为是要以新节点数组的顺序为老节点数组的序）
          // New element
          api.insertBefore(
            parentElm,
            createElm(newStartVnode, insertedVnodeQueue),
            oldStartVnode.elm!
          );
        } else {
          elmToMove = oldCh[idxInOld];
          if (elmToMove.sel !== newStartVnode.sel) {   // type1.没有对应的老节点（key相同但sel不同），需要创建dom对象并插入到老开始节点之前。（li不设置key问题）
            api.insertBefore(
              parentElm,
              createElm(newStartVnode, insertedVnodeQueue),
              oldStartVnode.elm!
            );
          } else {// type2.有对应的老节点，更新该老dom对象并插入到老开始节点之前
            patchVnode(elmToMove, newStartVnode, insertedVnodeQueue);
            oldCh[idxInOld] = undefined as any;
            api.insertBefore(parentElm, elmToMove.elm!, oldStartVnode.elm!);
          }
        }
        newStartVnode = newCh[++newStartIdx];
      }
    }
    if (oldStartIdx <= oldEndIdx || newStartIdx <= newEndIdx) { // 新或老children数组用完了，对比于新节点数组，老dom节点数组中多的删了，少的补上
      if (oldStartIdx > oldEndIdx) {  // type1：老children数组匹配完了，后面的新节点（[newStartIdx, newEndIdx]）直接加在最后老节点的后面就行
        before = newCh[newEndIdx + 1] == null ? null : newCh[newEndIdx + 1].elm;
        addVnodes(
          parentElm,
          before,
          newCh,
          newStartIdx,
          newEndIdx,
          insertedVnodeQueue
        );
      } else {  // type2：新children数组匹配完了，把多余的老dom节点（[oldStartIdx, oldEndIdx]）干掉
        removeVnodes(parentElm, oldCh, oldStartIdx, oldEndIdx);
      }
    }
  }


  function patchVnode(
    oldVnode: VNode,
    vnode: VNode,
    insertedVnodeQueue: VNodeQueue
  ) {
    const hook = vnode.data?.hook;
    hook?.prepatch?.(oldVnode, vnode);
    const elm = (vnode.elm = oldVnode.elm!);
    const oldCh = oldVnode.children as VNode[];
    const ch = vnode.children as VNode[];
    if (oldVnode === vnode) return;
    if (vnode.data !== undefined) {
      for (let i = 0; i < cbs.update.length; ++i)
        cbs.update[i](oldVnode, vnode);
      vnode.data.hook?.update?.(oldVnode, vnode);
    }
    if (isUndef(vnode.text)) {  // type1：新节点没有文本节点时的更新，也就是有可能有children或者没有children（没有children对dom来说并不是意味着没有子结点）
      if (isDef(oldCh) && isDef(ch)) {  // type1.1：新节点有children，老节点也有children
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue);
      } else if (isDef(ch)) { // type1.2新节点有children，老节点没有children
        if (isDef(oldVnode.text)) api.setTextContent(elm, "");  // 
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue);
      } else if (isDef(oldCh)) {  // type1.3新节点没有children，老节点有children
        removeVnodes(elm, oldCh, 0, oldCh.length - 1);
      } else if (isDef(oldVnode.text)) {// type1.3新节点没有children，老节点没有children（有可能有text）
        api.setTextContent(elm, "");
      }
    } else if (oldVnode.text !== vnode.text) {  // type2：新节点只有一个文本节点时的更新
      if (isDef(oldCh)) {
        removeVnodes(elm, oldCh, 0, oldCh.length - 1);
      }
      api.setTextContent(elm, vnode.text!);
    }
    hook?.postpatch?.(oldVnode, vnode);
  }
  return function patch(oldVnode: VNode | Element, vnode: VNode): VNode {
    let i: number, elm: Node, parent: Node;
    const insertedVnodeQueue: VNodeQueue = [];
    for (i = 0; i < cbs.pre.length; ++i) cbs.pre[i]();

    // step1：判断老节点是否是是一个dom节点，如果是就转换成虚拟dom节点
    if (!isVnode(oldVnode)) {
      oldVnode = emptyNodeAt(oldVnode);
    }
    // step2：判断新老节点是否相同（根据sel和key属性）
    if (sameVnode(oldVnode, vnode)) { // step3.1：如果相同就用新节点更新老节点
      patchVnode(oldVnode, vnode, insertedVnodeQueue);
    } else {  // step3.2：如果不同就用新节点“替换”老节点
      elm = oldVnode.elm!;
      parent = api.parentNode(elm) as Node;
      createElm(vnode, insertedVnodeQueue);
      if (parent !== null) {
        api.insertBefore(parent, vnode.elm!, api.nextSibling(elm));
        removeVnodes(parent, [oldVnode], 0, 0);
      }
    }

    for (i = 0; i < insertedVnodeQueue.length; ++i) {
      insertedVnodeQueue[i].data!.hook!.insert!(insertedVnodeQueue[i]);
    }
    for (i = 0; i < cbs.post.length; ++i) cbs.post[i]();
    return vnode;
  };
}
