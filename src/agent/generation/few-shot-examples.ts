/**
 * Hardcoded few-shot examples for code generation.
 *
 * These are production-quality Python examples for a fictional "Item" entity.
 * They show the LLM the exact pattern to follow — not templates, just examples.
 */

// ─── Service example ──────────────────────────────────────────────────────────

export const SERVICE_EXAMPLE = `\
# Simple service functions — no classes, direct crud delegation
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.crud.item import crud_item
from app.schemas.item import ItemCreate, ItemUpdate


def get_item_or_404(db: Session, item_id: int):
    obj = crud_item.get(db, id=item_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Item not found")
    return obj


def list_items(db: Session, skip: int = 0, limit: int = 100):
    return crud_item.get_multi(db, skip=skip, limit=limit)


def create_item(db: Session, data: ItemCreate):
    return crud_item.create(db, obj_in=data)


def update_item(db: Session, item_id: int, data: ItemUpdate):
    return crud_item.update(db, db_obj=get_item_or_404(db, item_id), obj_in=data)


def delete_item(db: Session, item_id: int):
    crud_item.remove(db, id=item_id)
`

// ─── Route example ────────────────────────────────────────────────────────────

export const ROUTE_EXAMPLE = `\
"""Item routes — REST endpoint handlers."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.item import ItemCreate, ItemUpdate, ItemResponse
from app.services.item_service import (
    create_item,
    delete_item,
    get_item_or_404,
    list_items,
    update_item,
)

router = APIRouter()


@router.get("/", response_model=List[ItemResponse])
async def list_items_endpoint(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
) -> List[ItemResponse]:
    """Return a paginated list of items."""
    return list_items(db, skip=skip, limit=limit)


@router.post("/", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item_endpoint(
    data: ItemCreate,
    db: Session = Depends(get_db),
) -> ItemResponse:
    """Create a new item."""
    return create_item(db, data)


@router.get("/{item_id}", response_model=ItemResponse)
async def get_item_endpoint(
    item_id: int,
    db: Session = Depends(get_db),
) -> ItemResponse:
    """Get an item by ID."""
    return get_item_or_404(db, item_id)


@router.put("/{item_id}", response_model=ItemResponse)
async def update_item_endpoint(
    item_id: int,
    data: ItemUpdate,
    db: Session = Depends(get_db),
) -> ItemResponse:
    """Update an existing item."""
    return update_item(db, item_id, data)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item_endpoint(
    item_id: int,
    db: Session = Depends(get_db),
) -> None:
    """Delete an item."""
    delete_item(db, item_id)
`

// ─── Auth route example ───────────────────────────────────────────────────────

export const AUTH_ROUTE_EXAMPLE = `\
"""Authentication routes — login and registration."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import create_access_token, get_password_hash, verify_password
from app.crud.user import crud_user
from app.schemas.user import UserCreate, UserResponse

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    data: UserCreate,
    db: Session = Depends(get_db),
) -> UserResponse:
    """Register a new user account."""
    existing = crud_user.get_by_email(db, email=data.email) if hasattr(crud_user, "get_by_email") else None
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )
    data.password_hash = get_password_hash(data.password_hash)
    return crud_user.create(db, obj_in=data)


@router.post("/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> dict:
    """Authenticate user and return JWT access token."""
    users = crud_user.get_multi(db)
    user = next((u for u in users if getattr(u, "email", None) == form_data.username), None)
    if not user or not verify_password(form_data.password, str(getattr(user, "password_hash", ""))):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(subject=str(user.id))
    return {"access_token": token, "token_type": "bearer"}
`

// ─── Test example ─────────────────────────────────────────────────────────────

export const TEST_EXAMPLE = `\
"""Integration tests for item endpoints."""
import pytest
from fastapi.testclient import TestClient


def test_list_items_empty(client: TestClient) -> None:
    """List endpoint returns empty array when no items exist."""
    response = client.get("/api/v1/items/")
    assert response.status_code == 200
    assert response.json() == []


def test_create_item(client: TestClient) -> None:
    """Creating an item returns 201 with the created data."""
    payload = {"name": "Test Item", "description": "A test item"}
    response = client.post("/api/v1/items/", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Item"
    assert "id" in data


def test_get_item(client: TestClient) -> None:
    """Getting an existing item returns 200 with data."""
    create_resp = client.post("/api/v1/items/", json={"name": "Fetchable"})
    item_id = create_resp.json()["id"]
    response = client.get(f"/api/v1/items/{item_id}")
    assert response.status_code == 200
    assert response.json()["id"] == item_id


def test_get_item_not_found(client: TestClient) -> None:
    """Getting a non-existent item returns 404."""
    response = client.get("/api/v1/items/999999")
    assert response.status_code == 404


def test_update_item(client: TestClient) -> None:
    """Updating an item returns the updated data."""
    create_resp = client.post("/api/v1/items/", json={"name": "Original"})
    item_id = create_resp.json()["id"]
    response = client.put(f"/api/v1/items/{item_id}", json={"name": "Updated"})
    assert response.status_code == 200
    assert response.json()["name"] == "Updated"


def test_delete_item(client: TestClient) -> None:
    """Deleting an item returns 204 No Content."""
    create_resp = client.post("/api/v1/items/", json={"name": "To Delete"})
    item_id = create_resp.json()["id"]
    response = client.delete(f"/api/v1/items/{item_id}")
    assert response.status_code == 204
`
