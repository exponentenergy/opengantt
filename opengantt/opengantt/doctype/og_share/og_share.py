import frappe
from frappe.model.document import Document
import json

class OGShare(Document):
    def get_context(self, context):
        context.no_cache = 1
        try:
            context.snapshot = json.loads(self.snapshot) if self.snapshot else {}
        except Exception:
            context.snapshot = {}
        return context
