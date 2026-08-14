# Phase 3.2 — Experience Memory: success/failure/skills
class ExperienceMemory:
    def __init__(self):
        self.memory = {"success": [], "failed": [], "skills": []}
    def store(self, outcome, task, feedback):
        self.memory[outcome].append({"task": task, "feedback": feedback})
