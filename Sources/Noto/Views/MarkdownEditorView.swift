import AppKit
import SwiftUI
import NotoCore

struct MarkdownEditorView: View {
    @Environment(AppState.self) private var appState
    let file: VaultFile?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let file {
                Text(file.title)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(NotoDesign.ink)
                    .padding(.horizontal, 48)
                    .padding(.top, 36)

                MarkdownTextView(
                    content: file.content,
                    onChange: { appState.updateActiveFileContent($0) }
                )
                .id(file.id)
                .padding(.horizontal, 42)
                .padding(.bottom, 36)
            } else {
                Text("No note selected.")
                    .foregroundStyle(NotoDesign.muted)
                    .padding(48)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct MarkdownTextView: NSViewRepresentable {
    let content: String
    let onChange: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onChange: onChange)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true

        let textView = KeyHandlingTextView()
        textView.string = content
        textView.delegate = context.coordinator
        textView.onKeyDown = context.coordinator.handleKeyDown
        textView.drawsBackground = false
        textView.textColor = NSColor(NotoDesign.ink)
        textView.insertionPointColor = NSColor(NotoDesign.accent)
        textView.font = .systemFont(ofSize: 16)
        textView.textContainerInset = NSSize(width: 6, height: 10)
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = true
        textView.isContinuousSpellCheckingEnabled = true
        textView.usesFindBar = true
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: scrollView.contentSize.width, height: CGFloat.greatestFiniteMagnitude)
        textView.minSize = NSSize(width: 0, height: scrollView.contentSize.height)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)

        scrollView.documentView = textView
        context.coordinator.textView = textView

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? KeyHandlingTextView else {
            return
        }

        textView.onKeyDown = context.coordinator.handleKeyDown
        context.coordinator.onChange = onChange

        if textView.string != content, !context.coordinator.isApplyingProgrammaticChange {
            let selectedRange = textView.selectedRange()
            textView.string = content
            textView.setSelectedRange(NSRange(
                location: min(selectedRange.location, (content as NSString).length),
                length: 0
            ))
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var onChange: (String) -> Void
        weak var textView: KeyHandlingTextView?
        var isApplyingProgrammaticChange = false

        init(onChange: @escaping (String) -> Void) {
            self.onChange = onChange
        }

        func textDidChange(_ notification: Notification) {
            guard !isApplyingProgrammaticChange, let textView = notification.object as? NSTextView else {
                return
            }

            onChange(textView.string)
        }

        func handleKeyDown(_ event: NSEvent, in textView: KeyHandlingTextView) -> Bool {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let hasCommand = flags.contains(.command)
            let hasControl = flags.contains(.control)
            let hasOption = flags.contains(.option)

            if hasCommand, !hasControl, !hasOption, let character = event.charactersIgnoringModifiers?.lowercased() {
                switch character {
                case "b":
                    apply(MarkdownEditor.applyInlineStyle(.bold, to: textView.string, selection: textView.selectedRange()), to: textView)
                    return true
                case "i":
                    apply(MarkdownEditor.applyInlineStyle(.italic, to: textView.string, selection: textView.selectedRange()), to: textView)
                    return true
                case "u":
                    apply(MarkdownEditor.applyInlineStyle(.underline, to: textView.string, selection: textView.selectedRange()), to: textView)
                    return true
                default:
                    break
                }
            }

            if !hasCommand, !hasControl, !hasOption, event.keyCode == 48 {
                apply(
                    MarkdownEditor.handleTab(
                        in: textView.string,
                        selection: textView.selectedRange(),
                        isShiftPressed: flags.contains(.shift)
                    ),
                    to: textView
                )
                return true
            }

            if !hasCommand, !hasControl, !hasOption, (event.keyCode == 36 || event.keyCode == 76) {
                apply(MarkdownEditor.handleEnter(in: textView.string, selection: textView.selectedRange()), to: textView)
                return true
            }

            if !hasCommand, !hasControl, !hasOption, event.keyCode == 49, shouldHandleBulletSpace(in: textView) {
                apply(MarkdownEditor.insertText(" ", into: textView.string, selection: textView.selectedRange()), to: textView)
                return true
            }

            return false
        }

        private func apply(_ edit: MarkdownEdit, to textView: NSTextView) {
            isApplyingProgrammaticChange = true
            textView.string = edit.content
            textView.setSelectedRange(edit.selection)
            isApplyingProgrammaticChange = false
            onChange(edit.content)
        }

        private func shouldHandleBulletSpace(in textView: NSTextView) -> Bool {
            let storage = textView.string as NSString
            let location = min(textView.selectedRange().location, storage.length)
            let beforeCursor = storage.substring(with: NSRange(location: 0, length: location))
            let currentLine = beforeCursor.components(separatedBy: "\n").last ?? ""
            return currentLine == "-"
        }
    }
}

private final class KeyHandlingTextView: NSTextView {
    var onKeyDown: (@MainActor (NSEvent, KeyHandlingTextView) -> Bool)?

    override func keyDown(with event: NSEvent) {
        if onKeyDown?(event, self) == true {
            return
        }

        super.keyDown(with: event)
    }
}
