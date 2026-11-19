class CommerceError(Exception):
    """A rule was broken. The router turns this into the matching HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status
