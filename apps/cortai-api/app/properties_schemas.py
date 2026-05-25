import uuid

from pydantic import BaseModel


class PropertyPublicRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str

