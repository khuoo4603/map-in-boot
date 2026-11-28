package com.mapinboot.security.collector;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

// Class Resource 기반 JVM Method Invocation·정적 문자열 추적
final class BytecodeUsageScanner {

    private BytecodeUsageScanner() {
    }

    static ScanResult scan(Class<?> targetClass) {
        String resourceName = targetClass.getName().replace('.', '/') + ".class";
        ClassLoader classLoader = targetClass.getClassLoader();
        InputStream input = classLoader == null
                ? ClassLoader.getSystemResourceAsStream(resourceName)
                : classLoader.getResourceAsStream(resourceName);
        if (input == null) {
            return new ScanResult(List.of(), "Class 바이트코드 조회 불가: " + targetClass.getName());
        }
        try (input) {
            UsageClassVisitor visitor = new UsageClassVisitor(targetClass.getName());
            new ClassReader(input).accept(visitor, ClassReader.SKIP_FRAMES);
            return new ScanResult(visitor.calls(), null);
        } catch (IOException exception) {
            return new ScanResult(List.of(), "Class 바이트코드 읽기 실패: " + targetClass.getName());
        }
    }

    record ScanResult(List<MethodCall> calls, String diagnostic) {
        ScanResult {
            calls = List.copyOf(calls);
        }
    }

    record MethodCall(
            String codeLocation,
            String owner,
            String name,
            String descriptor,
            List<String> argumentLiterals,
            int occurrence
    ) {
        MethodCall {
            argumentLiterals = Collections.unmodifiableList(new ArrayList<>(argumentLiterals));
        }

        String argumentLiteral(int index) {
            return index < argumentLiterals.size() ? argumentLiterals.get(index) : null;
        }
    }

    private record StackValue(String literal) {
        private static StackValue unknown() {
            return new StackValue(null);
        }
    }

    private static final class UsageClassVisitor extends ClassVisitor {
        private final String className;
        private final List<MethodCall> calls = new ArrayList<>();

        private UsageClassVisitor(String className) {
            super(Opcodes.ASM9);
            this.className = className;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor,
                                         String signature, String[] exceptions) {
            return new UsageMethodVisitor(className, name, descriptor, calls);
        }

        private List<MethodCall> calls() {
            return List.copyOf(calls);
        }
    }

    private static final class UsageMethodVisitor extends MethodVisitor {
        private final String codeLocation;
        private final Deque<StackValue> stack = new LinkedList<>();
        private final Map<Integer, StackValue> locals = new HashMap<>();
        private final Set<org.objectweb.asm.Label> exceptionHandlers = new HashSet<>();
        private final List<MethodCall> calls;
        private int occurrence;

        private UsageMethodVisitor(
                String className, String methodName, String methodDescriptor, List<MethodCall> calls) {
            super(Opcodes.ASM9);
            this.codeLocation = className + "#" + methodName + methodDescriptor;
            this.calls = calls;
        }

        @Override
        public void visitLdcInsn(Object value) {
            pushValue(value instanceof String string ? new StackValue(string) : StackValue.unknown(),
                    value instanceof Long || value instanceof Double ? 2 : 1);
        }

        @Override
        public void visitVarInsn(int opcode, int varIndex) {
            if (opcode == Opcodes.ASTORE) {
                locals.put(varIndex, popValue());
                return;
            }
            if (opcode == Opcodes.ALOAD) {
                pushValue(locals.getOrDefault(varIndex, StackValue.unknown()), 1);
                return;
            }
            if (opcode >= Opcodes.ISTORE && opcode <= Opcodes.DSTORE) {
                locals.remove(varIndex);
                pop(opcode == Opcodes.LSTORE || opcode == Opcodes.DSTORE ? 2 : 1);
            } else {
                pushValue(StackValue.unknown(), opcode == Opcodes.LLOAD || opcode == Opcodes.DLOAD ? 2 : 1);
            }
        }

        @Override
        public void visitTypeInsn(int opcode, String type) {
            if (opcode == Opcodes.NEW) {
                stack.push(StackValue.unknown());
            } else if (opcode == Opcodes.ANEWARRAY) {
                pop(1);
                stack.push(StackValue.unknown());
            } else if (opcode == Opcodes.CHECKCAST) {
                // CHECKCAST는 Operand Stack 값의 출처 보존
            }
        }

        @Override
        public void visitInsn(int opcode) {
            switch (opcode) {
                case Opcodes.ACONST_NULL, Opcodes.ICONST_M1, Opcodes.ICONST_0, Opcodes.ICONST_1,
                        Opcodes.ICONST_2, Opcodes.ICONST_3, Opcodes.ICONST_4, Opcodes.ICONST_5,
                        Opcodes.FCONST_0, Opcodes.FCONST_1, Opcodes.FCONST_2 -> stack.push(StackValue.unknown());
                case Opcodes.LCONST_0, Opcodes.LCONST_1, Opcodes.DCONST_0, Opcodes.DCONST_1 ->
                        pushValue(StackValue.unknown(), 2);
                case Opcodes.DUP -> stack.push(stack.isEmpty() ? StackValue.unknown() : stack.peek());
                case Opcodes.POP -> pop(1);
                case Opcodes.POP2 -> pop(2);
                case Opcodes.SWAP -> swap();
                case Opcodes.ARETURN, Opcodes.IRETURN, Opcodes.FRETURN, Opcodes.ATHROW -> pop(1);
                case Opcodes.LRETURN, Opcodes.DRETURN -> pop(2);
                default -> {
                }
            }
        }

        @Override
        public void visitIntInsn(int opcode, int operand) {
            if (opcode == Opcodes.NEWARRAY) {
                pop(1);
            }
            stack.push(StackValue.unknown());
        }

        @Override
        public void visitLabel(org.objectweb.asm.Label label) {
            if (exceptionHandlers.contains(label)) {
                stack.clear();
                locals.clear();
                stack.push(StackValue.unknown());
            }
        }

        @Override
        public void visitJumpInsn(int opcode, org.objectweb.asm.Label label) {
            stack.clear();
            locals.clear();
        }

        @Override
        public void visitLookupSwitchInsn(
                org.objectweb.asm.Label defaultHandler, int[] keys, org.objectweb.asm.Label[] labels) {
            stack.clear();
            locals.clear();
        }

        @Override
        public void visitTableSwitchInsn(
                int min, int max, org.objectweb.asm.Label defaultHandler, org.objectweb.asm.Label... labels) {
            stack.clear();
            locals.clear();
        }

        @Override
        public void visitFieldInsn(int opcode, String owner, String name, String descriptor) {
            if (opcode == Opcodes.GETSTATIC || opcode == Opcodes.GETFIELD) {
                if (opcode == Opcodes.GETFIELD) {
                    pop(1);
                }
                pushValue(StackValue.unknown(), Type.getType(descriptor).getSize());
            } else if (opcode == Opcodes.PUTFIELD) {
                pop(Type.getType(descriptor).getSize());
                pop(1);
            } else {
                pop(Type.getType(descriptor).getSize());
            }
        }

        @Override
        public void visitMethodInsn(int opcode, String owner, String name, String descriptor, boolean isInterface) {
            List<StackValue> arguments = arguments(descriptor);
            List<String> argumentLiterals = new ArrayList<>();
            for (StackValue argument : arguments) {
                argumentLiterals.add(argument.literal());
            }
            calls.add(new MethodCall(codeLocation, owner, name, descriptor, argumentLiterals, occurrence++));
            if (opcode != Opcodes.INVOKESTATIC) {
                pop(1);
            }
            Type returnType = Type.getReturnType(descriptor);
            if (!returnType.equals(Type.VOID_TYPE)) {
                pushValue(StackValue.unknown(), returnType.getSize());
            }
        }

        @Override
        public void visitInvokeDynamicInsn(
                String name, String descriptor, org.objectweb.asm.Handle bootstrapMethodHandle,
                Object... bootstrapMethodArguments) {
            arguments(descriptor);
            Type returnType = Type.getReturnType(descriptor);
            if (!returnType.equals(Type.VOID_TYPE)) {
                pushValue(StackValue.unknown(), returnType.getSize());
            }
        }

        @Override
        public void visitTryCatchBlock(org.objectweb.asm.Label start, org.objectweb.asm.Label end,
                                       org.objectweb.asm.Label handler, String type) {
            exceptionHandlers.add(handler);
        }

        @Override
        public void visitMultiANewArrayInsn(String descriptor, int dims) {
            pop(dims);
            stack.push(StackValue.unknown());
        }

        private List<StackValue> arguments(String descriptor) {
            List<Type> types = java.util.Arrays.asList(Type.getArgumentTypes(descriptor));
            List<StackValue> values = new ArrayList<>();
            for (int i = types.size() - 1; i >= 0; i--) {
                values.add(popValue());
                if (types.get(i).getSize() == 2) {
                    pop(1);
                }
            }
            java.util.Collections.reverse(values);
            return values;
        }

        private StackValue popValue() {
            return stack.isEmpty() ? StackValue.unknown() : stack.pop();
        }

        private void pushValue(StackValue value, int slots) {
            stack.push(value);
            if (slots == 2) {
                stack.push(StackValue.unknown());
            }
        }

        private void pop(int count) {
            for (int i = 0; i < count && !stack.isEmpty(); i++) {
                stack.pop();
            }
        }

        private void swap() {
            if (stack.size() < 2) {
                return;
            }
            StackValue first = stack.pop();
            StackValue second = stack.pop();
            stack.push(first);
            stack.push(second);
        }
    }
}
