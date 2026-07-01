import Foundation

public enum MockVault {
    public static let baseDate = Date(timeIntervalSince1970: 1_715_587_200)

    public static var school: Vault {
        Vault(id: "school-vault", name: "School Vault", files: [
            note(
                id: "biology-photosynthesis",
                path: "Biology/Photosynthesis.md",
                title: "Photosynthesis",
                content: """
                # Biology Lecture - Photosynthesis

                ## Key idea
                Photosynthesis is the process where plants convert light energy into chemical energy.

                ## Important terms
                - [[Chloroplast]]
                - [[Glucose]]
                - [[Carbon Dioxide]]
                - [[Cell Structure]]

                ## Summary
                The lecture explained how light-dependent reactions and the Calvin cycle work together.

                ## Questions to review
                - [ ] How does chlorophyll absorb light?
                - [ ] Why is glucose important for plant cells?
                - [ ] What is the role of carbon dioxide?
                """
            ),
            note(
                id: "biology-cell-structure",
                path: "Biology/Cell Structure.md",
                title: "Cell Structure",
                content: """
                # Cell Structure

                Organelles work together in plant and animal cells.

                ## Links
                - [[Photosynthesis]]
                - [[Chloroplast]]
                """
            ),
            note(
                id: "biology-enzymes",
                path: "Biology/Enzymes.md",
                title: "Enzymes",
                content: """
                # Enzymes

                Enzymes speed up reactions in cells and help metabolic pathways.

                ## Related
                - [[Photosynthesis]]
                - [[Glucose]]
                """
            ),
            note(
                id: "biology-chloroplast",
                path: "Biology/Chloroplast.md",
                title: "Chloroplast",
                content: """
                # Chloroplast

                Chloroplasts are organelles where [[Photosynthesis]] occurs.
                #biology
                """
            ),
            note(
                id: "biology-glucose",
                path: "Biology/Glucose.md",
                title: "Glucose",
                content: """
                # Glucose

                Glucose stores chemical energy produced by [[Photosynthesis]].
                """
            ),
            note(
                id: "biology-carbon-dioxide",
                path: "Biology/Carbon Dioxide.md",
                title: "Carbon Dioxide",
                content: """
                # Carbon Dioxide

                Carbon dioxide enters leaves through stomata and is used in [[Photosynthesis]].
                """
            ),
            note(
                id: "history-cold-war",
                path: "History/Cold War.md",
                title: "Cold War",
                content: """
                # Cold War

                A period of geopolitical tension after World War II.
                #history
                """
            ),
            note(
                id: "history-industrial-revolution",
                path: "History/Industrial Revolution.md",
                title: "Industrial Revolution",
                content: """
                # Industrial Revolution

                A major shift from hand production to machine production.
                """
            ),
            note(
                id: "math-logarithms",
                path: "Mathematics/Logarithms.md",
                title: "Logarithms",
                content: """
                # Logarithms

                Logarithms answer exponent questions.
                """
            ),
            note(
                id: "literature-macbeth",
                path: "Literature/Macbeth.md",
                title: "Macbeth",
                content: """
                # Macbeth

                A tragedy about ambition, guilt, and prophecy.
                """
            ),
            note(
                id: "ai-biology-lecture-may-13",
                path: "AI Lecture Notes/Biology Lecture - May 13.md",
                title: "Biology Lecture - May 13",
                content: """
                # Biology Lecture - May 13

                ## Today
                The teacher connected [[Photosynthesis]], [[Chloroplast]], [[Glucose]], and [[Cell Structure]].

                > Important: compare light-dependent reactions with the Calvin cycle.

                #lecture #biology
                """
            )
        ])
    }

    private static func note(id: String, path: String, title: String, content: String) -> VaultFile {
        VaultFile(
            id: id,
            path: path,
            title: title,
            content: content,
            createdAt: baseDate,
            updatedAt: baseDate
        )
    }
}
