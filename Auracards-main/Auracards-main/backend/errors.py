class UserError(Exception):
    """An error safe to show to the document's owner."""

    def __init__(self, message, status=422, code="invalid_document"):
        super().__init__(message)
        self.status = status
        self.code = code
