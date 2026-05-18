import json

from frappe.website.website_generator import WebsiteGenerator


class OGShare(WebsiteGenerator):
    def get_context(self, context):
        context.no_cache = 1
        try:
            context.snapshot = json.loads(self.snapshot) if self.snapshot else {}
        except Exception:
            context.snapshot = {}
        return context
