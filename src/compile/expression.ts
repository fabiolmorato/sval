import * as estree from 'estree'
import State from '../state'
import compile from '.'
import { OP } from '../share/const'
import { compileFunc, compileClass, compilePattern } from './helper'

export function ThisExpression(node: estree.ThisExpression, state: State) {
  state.opCodes.push({ op: OP.LOADV, val: state.symbols.get('this').pointer })
}

export function ArrayExpression(node: estree.ArrayExpression, state: State) {
  const spread: number[] = []
  for (let i = 0; i < node.elements.length; i++) {
    const item = node.elements[i]
    if (item.type === 'SpreadElement') {
      compile(item.argument, state)
      spread.push(i)
    } else {
      compile(item, state)
    }
  }
  spread.push(node.elements.length)
  state.opCodes.push({ op: OP.ARR, val: spread })
}

export function ObjectExpression(node: estree.ObjectExpression, state: State) {
  const propKinds: string[] = []
  for (let i = 0; i < node.properties.length; i++) {
    const property = node.properties[i]
    if (property.type as any === 'SpreadElement') {
      state.opCodes.push({ op: OP.LOADK, val: null }) // placeholder for spread element
      compile((property as any).argument, state)
      propKinds.push('sprd')
    } else {
      // key
      const propKey = property.key
      if (propKey.type === 'Identifier') {
        state.opCodes.push({ op: OP.LOADK, val: propKey.name })
      } else { // property.computed === true
        compile(propKey, state)
      }
      // value
      compile(property.value, state)
      propKinds.push(property.kind)
    }
  }
  state.opCodes.push({ op: OP.OBJ, val: propKinds })
}

export function FunctionExpression(node: estree.FunctionExpression, state: State) {
  if (node.id && node.id.name) {
    state.symbols.pushScope()
    // allocate a placeholder for a tmp function to use inside the function scope
    const pointer = state.symbols.set(node.id.name, 'const').pointer
    state.opCodes.push({ op: OP.LOADK })
    state.opCodes.push({ op: OP.ALLOC, val: pointer })
    // compile the function
    compileFunc(node, state)
    // store the function into the placeholder above
    state.opCodes.push({ op: OP.COPY })
    state.opCodes.push({ op: OP.STORE, val: pointer })
    state.symbols.popScope()
  } else {
    compileFunc(node, state)
  }
}

export function UnaryExpression(node: estree.UnaryExpression, state: State) {
  if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
    try {
      state.opCodes.push({ op: OP.LOADV, val: state.symbols.get(node.argument.name).pointer })
    } catch (err) {
      state.opCodes.push({ op: OP.LOADK })
    }
  } else {
    compile(node.argument, state)
  }
  state.opCodes.push({ op: OP.UNOP, val: node.operator })
}

export function UpdateExpression(node: estree.UpdateExpression, state: State) {
  if (node.argument.type === 'Identifier') {
    // load value
    const pointer = state.symbols.get(node.argument.name).pointer
    state.opCodes.push({ op: OP.LOADV, val: pointer })
    // update value
    if (!node.prefix) {
      state.opCodes.push({ op: OP.COPY })
    }
    state.opCodes.push({ op: OP.LOADK, val: 1 })
    state.opCodes.push({ op: OP.BIOP, val: node.operator[0] })
    if (node.prefix) {
      state.opCodes.push({ op: OP.COPY })
    }
    // store value
    state.opCodes.push({ op: OP.STORE, val: pointer })
  } else if (node.argument.type === 'MemberExpression') {
    // load value
    compile(node.argument, state)
    // update value
    if (!node.prefix) {
      state.opCodes.push({ op: OP.COPY })
    }
    state.opCodes.push({ op: OP.LOADK, val: 1 })
    state.opCodes.push({ op: OP.BIOP, val: node.operator[0] })
    if (node.prefix) {
      state.opCodes.push({ op: OP.COPY })
    }
    // store value
    compile(node.argument.object, state)
    const property = node.argument.property
    if (property.type === 'Identifier') {
      state.opCodes.push({ op: OP.LOADK, val: property.name })
    } else { // node.computed === true
      compile(property, state)
    }
    state.opCodes.push({ op: OP.MSET })
  }
}

export function BinaryExpression(node: estree.BinaryExpression, state: State) {
  compile(node.left, state)
  compile(node.right, state)
  state.opCodes.push({ op: OP.BIOP, val: node.operator })
}

export function AssignmentExpression(node: estree.AssignmentExpression, state: State) {
  compile(node.right, state)
  state.opCodes.push({ op: OP.COPY })
  const left = node.left
  if (left.type === 'Identifier') {
    const symbol = state.symbols.get(left.name)
    if (symbol.type === 'const') {
      throw new TypeError('Assignment to constant variable')
    }
    const binaryOp = node.operator.substring(0, node.operator.length - 1)
    if (binaryOp) {
      state.opCodes.push({ op: OP.LOADV, val: symbol.pointer })
      state.opCodes.push({ op: OP.BIOP, val: binaryOp })
    }
    state.opCodes.push({ op: OP.STORE, val: symbol.pointer })
  } else if (left.type === 'MemberExpression') {
    compile(left.object, state)
    const property = left.property
    if (property.type === 'Identifier') {
      state.opCodes.push({ op: OP.LOADK, val: property.name })
    } else { // node.computed === true
      compile(property, state)
    }
    state.opCodes.push({ op: OP.MSET })
  } else {
    compilePattern(left, state)
  }
}

export function LogicalExpression(node: estree.LogicalExpression, state: State) {
  compile(node.left, state)
  compile(node.right, state)
  state.opCodes.push({ op: OP.BIOP, val: node.operator })
}

export function MemberExpression(node: estree.MemberExpression, state: State) {
  compile(node.object, state)
  const property = node.property
  if (property.type === 'Identifier') {
    state.opCodes.push({ op: OP.LOADK, val: property.name })
  } else { // node.computed === true
    compile(property, state)
  }
  state.opCodes.push({ op: OP.MGET })
}

export function ConditionalExpression(node: estree.ConditionalExpression, state: State) {
  compile(node.test, state)
  const ifnotCode = { op: OP.IFNOT, val: -1 }
  state.opCodes.push(ifnotCode)
  // if true
  compile(node.consequent, state)
  const trueEndCode = { op: OP.JMP, val: -1 }
  state.opCodes.push(trueEndCode)
  ifnotCode.val = state.opCodes.length
  // else
  compile(node.alternate, state)
  trueEndCode.val = state.opCodes.length
}

export function CallExpression(node: estree.CallExpression, state: State) {
  const spread: number[] = []
  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i]
    if (arg.type === 'SpreadElement') {
      compile(arg.argument, state)
      spread.push(i)
    } else {
      compile(arg, state)
    }
  }
  spread.push(node.arguments.length)

  const callee = node.callee
  if (callee.type === 'MemberExpression') {
    compile(callee.object, state)
    state.opCodes.push({ op: OP.COPY })
    const property = callee.property
    if (property.type === 'Identifier') {
      state.opCodes.push({ op: OP.LOADK, val: property.name })
    } else { // node.computed === true
      compile(property, state)
    }
    state.opCodes.push({ op: OP.MGET })
  } else {
    state.opCodes.push({ op: OP.LOADV, val: state.symbols.get('this').pointer })
    compile(callee, state)
  }

  const catchPcStack = state.catchPcStack
  state.opCodes.push({
    op: OP.CALL,
    val: spread,
    catch: catchPcStack[catchPcStack.length - 1]
  })
}

export function NewExpression(node: estree.NewExpression, state: State) {
  const spread: number[] = []
  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i]
    if (arg.type === 'SpreadElement') {
      compile(arg.argument, state)
      spread.push(i)
    } else {
      compile(arg, state)
    }
  }
  spread.push(node.arguments.length)

  compile(node.callee, state)

  const catchPcStack = state.catchPcStack
  state.opCodes.push({
    op: OP.NEW,
    val: spread,
    catch: catchPcStack[catchPcStack.length - 1]
  })
}

export function MetaProperty(node: estree.MetaProperty, state: State) {
}

export function SequenceExpression(node: estree.SequenceExpression, state: State) {
  for (let i = 0; i < node.expressions.length; i++) {
    compile(node.expressions[i], state)
  }
}

export function ArrowFunctionExpression(node: estree.ArrowFunctionExpression, state: State) {
  compileFunc(node, state)
}

export function TemplateLiteral(node: estree.TemplateLiteral, state: State) {
  const quasis = node.quasis
  const expressions = node.expressions

  state.opCodes.push({ op: OP.LOADK, val: quasis.shift().value.raw })

  let expr: estree.Expression
  while (expr = expressions.shift()) {
    compile(expr, state)
    state.opCodes.push({ op: OP.BIOP, val: '+' })
    state.opCodes.push({ op: OP.LOADK, val: quasis.shift().value.raw })
    state.opCodes.push({ op: OP.BIOP, val: '+' })
  }
}

export function TaggedTemplateExpression(node: estree.TaggedTemplateExpression, state: State) {
}

export function ClassExpression(node: estree.ClassExpression, state: State) {
  if (node.id && node.id.name) {
    state.symbols.pushScope()
    // allocate a placeholder for a tmp class to use inside the constructor function scope
    const pointer = state.symbols.set(node.id.name, 'const').pointer
    state.opCodes.push({ op: OP.LOADK })
    state.opCodes.push({ op: OP.ALLOC, val: pointer })
    // compile the class
    compileClass(node, state)
    // store the class into the placeholder above
    state.opCodes.push({ op: OP.COPY })
    state.opCodes.push({ op: OP.STORE, val: pointer })
    state.symbols.popScope()
  } else {
    compileClass(node, state)
  }
}

export function Super(node: estree.Super, state: State) {
  state.opCodes.push({ op: OP.LOADV, val: state.symbols.get('super').pointer })
}

export function YieldExpression(node: estree.YieldExpression, state: State) {
  compile(node.argument, state)
  state.opCodes.push({ op: OP.YIELD, val: node.delegate })
}

export function AwaitExpression(node: estree.AwaitExpression, state: State) {
  compile(node.argument, state)
  state.opCodes.push({ op: OP.AWAIT })
}