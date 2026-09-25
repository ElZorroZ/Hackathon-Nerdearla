"""Rutas de administración del glosario técnico."""

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter
from pydantic import BaseModel

if TYPE_CHECKING:
    from src.services.glossary_manager import GlossaryManager

logger = logging.getLogger("api.glossary")

router = APIRouter(prefix="/api/admin/glossary", tags=["glossary"])


class GlossaryTerm(BaseModel):
    original: str
    translation: str


class GlossaryDelete(BaseModel):
    original: str


def init_glossary_routes(glossary: "GlossaryManager"):

    @router.get("")
    async def get_glossary():
        return {"terms": glossary.get_all()}

    @router.post("")
    async def add_term(term: GlossaryTerm):
        ok = glossary.add_term(term.original, term.translation)
        return {"status": "added" if ok else "error", "term": term.original}

    @router.put("")
    async def update_term(term: GlossaryTerm):
        ok = glossary.update_term(term.original, term.translation)
        return {"status": "updated" if ok else "not_found", "term": term.original}

    @router.delete("")
    async def delete_term(term: GlossaryDelete):
        ok = glossary.delete_term(term.original)
        return {"status": "deleted" if ok else "not_found", "term": term.original}
